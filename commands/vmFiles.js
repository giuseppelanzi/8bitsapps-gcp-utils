const fs = require("fs/promises");
const path = require("path");
const inquirer = require("inquirer");
const Compute = require("../GCPUtilities/Compute.js");
const FilterableListPrompt = require("../utils/prompts/filterableList.js");
const FilterableCheckboxPrompt = require("../utils/prompts/filterableCheckbox.js");
const ListWithEscapePrompt = require("../utils/prompts/listWithEscape.js");
const { getSettings } = require("../utils/settings.js");
const { loadConfiguration } = require("../utils/configLoader.js");
const { describeAuthError } = require("../utils/gcpAuth.js");
const gcloud = require("../utils/gcloud.js");
const remoteFiles = require("../utils/remoteFiles.js");
const vmConnect = require("./vmConnect.js");
const { showMigrationHint } = require("./auth.js");
const ui = require("../utils/ui.js");
//
// Register custom prompts.
inquirer.registerPrompt("filterableList", FilterableListPrompt);
inquirer.registerPrompt("filterableCheckbox", FilterableCheckboxPrompt);
inquirer.registerPrompt("listWithEscape", ListWithEscapePrompt);
//
// Control characters, a line break among them, which would break a row of the list.
const CONTROL_CHARS_PATTERN = /\p{Cc}/gu;
const HAS_CONTROL_CHARS_PATTERN = /\p{Cc}/u;
//
// Control characters but the line break, which a message may span: an escape sequence
// in a remote name or in what the VM printed must never reach the terminal.
const MESSAGE_CONTROL_CHARS_PATTERN = /(?!\n)\p{Cc}/gu;
//
// Where a remote name stands compared with a local file of the same name.
const TARGET_NONE = "none";
const TARGET_FILE = "file";
const TARGET_OTHER = "other";
//
// --- UI: Render and display functions. ---
//
/**
 * Builds the key hint suffix for the navigation prompt message.
 * @param {boolean} backEnabled - Whether the left arrow goes to the parent folder.
 * @returns {string} Hint string.
 */
function navigationHint(backEnabled) {
  return backEnabled
    ? "(type to filter, ← parent, DEL delete file, ESC exit)"
    : "(type to filter, DEL delete file, ESC exit)";
}
//
/**
 * Builds the beginning of a navigation trail line, as the prompt showed it.
 * @param {string} instanceName - VM instance name.
 * @param {string} dir - Remote folder shown by the prompt.
 * @param {boolean} backEnabled - Whether the prompt offered the parent folder.
 * @returns {string} The trail head.
 */
function formatTrailHead(instanceName, dir, backEnabled) {
  return `? ${instanceName}:${displayName(dir)} ${navigationHint(backEnabled)}`;
}
//
/**
 * Rewrites the line of the prompt that just closed, which sits right above the
 * cursor, and moves to the next line.
 * @param {string} text - Trail line.
 */
function writeTrail(text) {
  ui.overwriteLineAbove(text);
  ui.writeInline("\n");
}
//
/**
 * Makes a file name safe for one row of a list: control characters become "?".
 * @param {string} name - File name.
 * @returns {string} The name to show.
 */
function displayName(name) {
  return name.replace(CONTROL_CHARS_PATTERN, "?");
}
//
/**
 * Makes a message safe for the terminal: control characters but line breaks become "?".
 * Error messages carry remote names and what the VM printed.
 * @param {string} message - Message.
 * @returns {string} The message to show.
 */
function displayMessage(message) {
  return String(message).replace(MESSAGE_CONTROL_CHARS_PATTERN, "?");
}
//
/**
 * Formats the equivalent command of an operation for the log. A path with control
 * characters gets no command: shown with "?", it would name another file.
 * @param {string} remotePath - Remote path of the operation.
 * @param {string} command - Equivalent command.
 * @returns {string} Log message.
 */
function formatEquivalent(remotePath, command) {
  if (HAS_CONTROL_CHARS_PATTERN.test(remotePath)) {
    return "Equivalent command not shown: the name contains control characters.";
  }
  return `Equivalent command: ${command}`;
}
//
/**
 * Draws a progress line, in place of the one before: the line of a transfer, rewritten
 * every second, and those of a listing or a deletion. A line that wraps leaves a line
 * behind, since clearLine() clears only the last one, so it fits the terminal width
 * less one column. Only the name is shortened, in the middle; if the line does not fit
 * even with "…" for a name, the measure goes, and on a terminal narrower still the
 * message is cut at the end. The name goes through displayName() first, so no control
 * character reaches the terminal or skews the count.
 * @param {string} action - "Uploading", "Downloading", "Listing" or "Deleting".
 * @param {string} name - File name, or remote folder for a listing.
 * @param {string} [counter] - Position in the queue, such as " (1/3)"; empty by default.
 * @param {object} [sample] - Measure, see remoteFiles.watchTransfer(); absent before the first one, and for a listing or a deletion.
 */
function showProgressLine(action, name, counter = "", sample = null) {
  const shown = displayName(name);
  const width = ui.terminalWidth() - 1;
  const details = sample ? [ui.formatTransferStats(sample), ""] : [""];
  let message = null;
  let detail = "";
  for (const candidate of details) {
    const room = width - ui.displayWidth(ui.formatProgress(`${action} ${counter}`, candidate));
    const fitted = ui.truncateMiddle(shown, room);
    if (fitted) {
      message = `${action} ${fitted}${counter}`;
      detail = candidate;
      break;
    }
  }
  if (message === null) {
    message = ui.truncateEnd(`${action} ${shown}${counter}`, width - ui.displayWidth(ui.formatProgress("")));
  }
  ui.clearLine();
  ui.showProgress(message, detail);
}
//
/**
 * Shows why the files of a VM could not be opened, as showTunnelFailure() does for RDP:
 * the error, which already carries gcloud's last lines; an authentication hint instead
 * of the SSH ones when the credentials are the cause; the SSH hints only for a failure
 * of gcloud or ssh, recognized by its stderr property, even an empty one.
 * @param {Error} err - Error of remoteFiles.openRemoteFiles().
 * @param {boolean} tunnelThroughIap - Whether the connection went through IAP.
 */
function showOpenFailure(err, tunnelThroughIap) {
  if (err.interrupted) {
    ui.showInfo("Connection interrupted.");
    return;
  }
  ui.showError(displayMessage(err.message));
  const authHint = describeAuthError(err);
  if (authHint) {
    ui.showWarning(authHint);
    return;
  }
  if (typeof err.stderr === "string") {
    vmConnect.showSshFailureHints(undefined, tunnelThroughIap);
  }
}
//
// --- UX: Prompt functions. ---
//
/**
 * Shows the remote folder navigation menu, with incremental filter and load-more.
 * @param {string} instanceName - VM instance name.
 * @param {string} dir - Current remote folder.
 * @param {{folders: Array, files: Array}} listing - Folder contents.
 * @param {{maxItems: number, pageStep: number, backEnabled: boolean}} options - Menu options.
 * @returns {Promise<{action: string, value?: object}|null>} Selected action, or null on ESC.
 */
async function showNavigationMenu(instanceName, dir, listing, options) {
  const source = [];
  for (const folder of listing.folders) {
    const name = displayName(folder.name);
    source.push({
      name: `[D] ${name}${folder.link ? " (link)" : ""}`,
      value: { action: "folder", value: folder },
      search: name.toLowerCase()
    });
  }
  for (const file of listing.files) {
    const name = displayName(file.name);
    source.push({
      name: `[F] ${name} (${file.link ? "link" : ui.formatSize(file.size)})`,
      value: { action: "file", value: file },
      search: name.toLowerCase()
    });
  }
  //
  // Fixed action rows: never filtered, never counted in the window.
  const footer = [];
  if (source.length > 0) {
    footer.push(new inquirer.Separator("─".repeat(13)));
  }
  footer.push({ name: ui.formatUploadFilesChoice(), value: { action: "upload" } });
  //
  const { selected } = await inquirer.prompt([{
    type: "filterableList",
    name: "selected",
    message: `${instanceName}:${displayName(dir)} ${navigationHint(options.backEnabled)}`,
    source,
    footer,
    pageWindow: options.maxItems,
    pageStep: options.pageStep,
    enableBack: options.backEnabled,
    deleteFilter: value => value?.action === "file",
    formatLoadMore: ui.formatLoadMore,
    noMatchesText: ui.formatNoMatches
  }]);
  return selected;
}
//
/**
 * Asks which local files to upload.
 * @param {Array<{name: string, size: number}>} files - Regular files of the local folder.
 * @param {string} localDir - Local folder.
 * @param {{maxItems: number, pageStep: number}} options - Window options.
 * @returns {Promise<string[]|null>} Selected file names, or the highlighted one when none is selected; null on ESC.
 */
async function promptLocalFiles(files, localDir, options) {
  const { selected } = await inquirer.prompt([{
    type: "filterableCheckbox",
    name: "selected",
    message: `Files to upload from ${displayName(localDir)} (type to search, SPACE select, ENTER upload, ESC cancel)`,
    source: files.map(file => ({
      name: `${displayName(file.name)} (${ui.formatSize(file.size)})`,
      value: file.name,
      short: displayName(file.name),
      search: displayName(file.name).toLowerCase()
    })),
    pageWindow: options.maxItems,
    pageStep: options.pageStep,
    formatMark: ui.formatCheckMark,
    formatCommand: ui.formatSelectionCommand,
    formatAnswer: ui.formatCyan,
    formatLoadMore: ui.formatLoadMore,
    noMatchesText: ui.formatNoMatches
  }]);
  return selected;
}
//
/**
 * Asks what to do with a file of an upload that already exists on the VM. With several
 * conflicts the choice can stand for all the ones left; with one, there is no "all" and
 * no counter. Skip is preselected, by value, since a number would be an index from 0.
 * @param {string} name - File name.
 * @param {number} index - Position of this conflict, from 1.
 * @param {number} total - Number of conflicts in the upload.
 * @returns {Promise<string|null>} "overwrite", "overwriteAll", "skip" or "skipAll"; null on ESC.
 */
async function askOverwrite(name, index, total) {
  const many = total > 1;
  const choices = many
    ? [
      { name: "1. Overwrite", value: "overwrite" },
      { name: "2. Overwrite all", value: "overwriteAll" },
      { name: "3. Skip", value: "skip" },
      { name: "4. Skip all", value: "skipAll" }
    ]
    : [
      { name: "1. Overwrite", value: "overwrite" },
      { name: "2. Skip", value: "skip" }
    ];
  const { choice } = await inquirer.prompt([{
    type: "listWithEscape",
    name: "choice",
    message: many ? `Overwrite ${displayName(name)} on the VM? (${index}/${total} conflicts)` : `Overwrite ${displayName(name)} on the VM?`,
    choices,
    default: "skip",
    enableBack: false,
    deleteFilter: () => false
  }]);
  return choice;
}
//
/**
 * Asks to confirm an action on a file: overwriting or deleting it. No is the default.
 * @param {string} message - Question.
 * @returns {Promise<boolean>} True to go on.
 */
async function confirmAction(message) {
  const { confirmed } = await inquirer.prompt([{
    type: "confirm",
    name: "confirmed",
    message,
    default: false
  }]);
  return confirmed;
}
//
// --- Local and remote targets. ---
//
/**
 * Lists the regular files of a local folder, links followed. An entry that cannot be
 * read, such as a broken link, is left out instead of failing the whole list.
 * @param {string} dir - Local folder.
 * @returns {Promise<Array<{name: string, size: number}>>} The files, sorted by name.
 */
async function listLocalFiles(dir) {
  const files = [];
  for (const name of await fs.readdir(dir)) {
    try {
      const stat = await fs.stat(path.join(dir, name));
      if (stat.isFile()) {
        files.push({ name, size: stat.size });
      }
    } catch {
      // A broken link or an unreadable entry: left out.
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}
//
/**
 * Tells what stands at a local path, without following links: a download never writes
 * through a link.
 * @param {string} localPath - Local path.
 * @returns {Promise<string>} TARGET_NONE, TARGET_FILE for a regular file, TARGET_OTHER for anything else.
 */
async function describeLocalTarget(localPath) {
  try {
    const stat = await fs.lstat(localPath);
    return stat.isFile() ? TARGET_FILE : TARGET_OTHER;
  } catch (err) {
    if (err.code === "ENOENT") {
      return TARGET_NONE;
    }
    throw err;
  }
}
//
/**
 * Tells what stands at a name of the current remote folder, from the listing in memory:
 * an upload never writes through a link, a broken one included.
 * @param {{folders: Array, files: Array, others: string[]}} listing - Folder contents.
 * @param {string} name - File name.
 * @returns {string} TARGET_NONE, TARGET_FILE for a regular file, TARGET_OTHER for anything else.
 */
function describeRemoteTarget(listing, name) {
  if (listing.files.some(file => file.name === name && !file.link)) {
    return TARGET_FILE;
  }
  const taken = listing.folders.some(folder => folder.name === name)
    || listing.files.some(file => file.name === name)
    || listing.others.includes(name);
  return taken ? TARGET_OTHER : TARGET_NONE;
}
//
// --- Connection. ---
//
/**
 * Checks the key pair before any connection. Without ssh.keyFile on macOS and Linux,
 * gcloud's own pair is checked too: the master connection runs with stdin closed, so
 * gcloud could not ask for the passphrase of a new pair.
 * @param {object} configuration - Configuration object.
 * @returns {Promise<string|null>} What is wrong with the key pair, or null.
 */
async function describeKeyProblem(configuration) {
  const { sshKeyFile, problem } = await vmConnect.resolveKeyFile(configuration);
  if (problem) {
    return problem;
  }
  if (sshKeyFile || !remoteFiles.supportsSharedConnection()) {
    return null;
  }
  const defaultKey = gcloud.defaultSshKeyFile();
  try {
    await fs.stat(defaultKey);
  } catch (err) {
    if (err.code === "ENOENT") {
      return `gcloud has no SSH key yet (${defaultKey}): connect once with "Connect to a VM (SSH/RDP)", which creates it, then come back.`;
    }
  }
  return gcloud.describeSshKeyProblem(defaultKey);
}
//
/**
 * Opens the files of a VM as the identity of a configuration.
 * @param {object} configuration - Configuration object, with an auth identity.
 * @param {object} instance - Running Linux instance from Compute.listInstances().
 * @returns {Promise<object|null>} The remote files from remoteFiles.openRemoteFiles(), or null if they did not open.
 */
async function openFiles(configuration, instance) {
  const { sshKeyFile } = await vmConnect.resolveKeyFile(configuration);
  const session = await vmConnect.prepareSshSession(configuration, instance, sshKeyFile);
  if (!remoteFiles.supportsSharedConnection()) {
    ui.writeInline(ui.formatGray("On Windows every operation runs gcloud on its own: each one takes a few seconds.\n"));
  }
  vmConnect.releaseTerminal();
  try {
    return await remoteFiles.openRemoteFiles(session);
  } catch (err) {
    showOpenFailure(err, session.tunnelThroughIap);
    return null;
  }
}
//
// --- Navigator. ---
//
/**
 * Lists a remote folder behind a progress line, which is cleared either way.
 * @param {object} files - Remote files.
 * @param {string} dir - Absolute remote folder.
 * @returns {Promise<object>} The listing.
 * @throws {Error} If the folder cannot be read.
 */
async function listWithProgress(files, dir) {
  showProgressLine("Listing", dir);
  try {
    return await files.list(dir);
  } finally {
    ui.clearLine();
  }
}
//
/**
 * Adds the warning of a partial listing to the operation log.
 * @param {Array} logs - Operation log.
 * @param {{warning: string|null}} listing - Listing.
 */
function logListingWarning(logs, listing) {
  if (listing.warning) {
    logs.push({ type: "error", message: `Partial listing: ${displayMessage(listing.warning)}` });
  }
}
//
/**
 * Downloads a remote file into the local folder. A regular local file of the same name
 * is overwritten only on confirmation; anything else of that name stops the download.
 * @param {object} files - Remote files.
 * @param {string} remotePath - Absolute remote path.
 * @param {{name: string, size: number|null}} file - File, from the listing; size is null for a link.
 * @param {Array} logs - Operation log.
 * @returns {Promise<void>}
 */
async function downloadFile(files, remotePath, file, logs) {
  const name = file.name;
  const localPath = path.join(process.cwd(), name);
  let target;
  try {
    target = await describeLocalTarget(localPath);
  } catch (err) {
    logs.push({ type: "error", message: `Download failed: ${displayName(name)} - ${displayMessage(err.message)}` });
    return;
  }
  if (target === TARGET_OTHER) {
    logs.push({ type: "error", message: `Not downloaded: "${displayName(localPath)}" exists and is not a regular file.` });
    return;
  }
  if (target === TARGET_FILE && !await confirmAction(`Overwrite local file ${displayName(name)}?`)) {
    logs.push({ type: "info", message: `Skipped: ${displayName(name)}` });
    return;
  }
  showProgressLine("Downloading", name, "");
  try {
    await files.download(remotePath, name, {
      total: file.size,
      onProgress: sample => showProgressLine("Downloading", name, "", sample)
    });
    ui.clearLine();
    logs.push({ type: "success", message: `Downloaded: ${displayName(name)} → ${displayName(localPath)}` });
    logs.push({ type: "info", message: formatEquivalent(remotePath, files.describeTransfer({ direction: "download", remotePath, localName: name })) });
  } catch (err) {
    ui.clearLine();
    logs.push({ type: "error", message: `Download failed: ${displayName(name)} - ${displayMessage(err.message)}` });
  }
}
//
/**
 * Uploads local files into the current remote folder, one at a time. A regular remote
 * file of the same name is overwritten only on confirmation; anything else of that
 * name, a link included, skips the file.
 * @param {object} files - Remote files.
 * @param {string} instanceName - VM instance name.
 * @param {string} dir - Current remote folder.
 * @param {Array} logs - Operation log.
 * @param {{maxItems: number, pageStep: number}} options - Window options of the file selection.
 * @returns {Promise<number>} How many files were uploaded.
 */
async function uploadFiles(files, instanceName, dir, logs, options) {
  const localDir = process.cwd();
  let candidates;
  try {
    candidates = await listLocalFiles(localDir);
  } catch (err) {
    logs.push({ type: "error", message: `Cannot read ${displayName(localDir)}: ${displayMessage(err.message)}` });
    return 0;
  }
  if (candidates.length === 0) {
    logs.push({ type: "info", message: `No files to upload in ${displayName(localDir)}.` });
    return 0;
  }
  const selected = await promptLocalFiles(candidates, localDir, options);
  if (!selected) {
    return 0;
  }
  //
  // The folder is listed again first, so the questions and the refusal of links see
  // the VM as it is now, not as it was at the last listing.
  let current;
  try {
    current = await listWithProgress(files, dir);
  } catch (err) {
    logs.push({ type: "error", message: `Upload cancelled: cannot list ${displayName(dir)}: ${displayMessage(err.message)}` });
    return 0;
  }
  //
  // Every question comes before any copy, so ESC can cancel the whole upload. The lines
  // of this loop reach the log only if it gets to the end.
  const total = selected.filter(name => describeRemoteTarget(current, name) === TARGET_FILE).length;
  const queue = [];
  const decisions = [];
  let forAll = null;
  let conflict = 0;
  for (const name of selected) {
    const target = describeRemoteTarget(current, name);
    if (target === TARGET_OTHER) {
      decisions.push({ type: "error", message: `Not uploaded: ${displayName(name)} exists on the VM and is not a regular file.` });
      continue;
    }
    if (target === TARGET_FILE) {
      conflict++;
      const choice = forAll || await askOverwrite(name, conflict, total);
      if (choice === null) {
        logs.push({ type: "info", message: "Upload cancelled: nothing uploaded." });
        return 0;
      }
      if (choice === "overwriteAll" || choice === "skipAll") {
        forAll = choice;
      }
      if (choice === "skip" || choice === "skipAll") {
        decisions.push({ type: "info", message: `Skipped: ${displayName(name)}` });
        continue;
      }
    }
    queue.push(name);
  }
  logs.push(...decisions);
  //
  let uploaded = 0;
  for (const [index, name] of queue.entries()) {
    const remotePath = remoteFiles.joinRemotePath(dir, name);
    const counter = ` (${index + 1}/${queue.length})`;
    const existing = current.files.find(entry => entry.name === name && !entry.link);
    showProgressLine("Uploading", name, counter);
    try {
      await files.upload(name, remotePath, {
        previous: existing ? existing.size : null,
        onProgress: sample => showProgressLine("Uploading", name, counter, sample)
      });
      ui.clearLine();
      uploaded++;
      logs.push({ type: "success", message: `Uploaded: ${displayName(name)} → ${instanceName}:${displayName(remotePath)}` });
      logs.push({ type: "info", message: formatEquivalent(remotePath, files.describeTransfer({ direction: "upload", remotePath, localName: name })) });
    } catch (err) {
      ui.clearLine();
      logs.push({ type: "error", message: `Upload failed: ${displayName(name)} - ${displayMessage(err.message)}` });
      if (!files.isOpen()) {
        const left = queue.length - index - 1;
        if (left > 0) {
          logs.push({ type: "error", message: `Not uploaded: ${left} more ${left === 1 ? "file" : "files"}, since the connection closed.` });
        }
        break;
      }
    }
  }
  return uploaded;
}
//
/**
 * Deletes one remote file, or the link itself for a link, after a confirmation. The
 * entry leaves the listing in memory, so no new listing is needed.
 * @param {object} files - Remote files.
 * @param {string} dir - Current remote folder.
 * @param {object} listing - Listing of the current remote folder.
 * @param {{name: string}} file - File to delete, from the listing.
 * @param {Array} logs - Operation log.
 * @returns {Promise<object>} The listing without the file, or the same listing if nothing was deleted.
 */
async function deleteFile(files, dir, listing, file, logs) {
  const name = displayName(file.name);
  const question = file.link ? `Delete link ${name} on the VM? The file it points to stays.` : `Delete ${name} on the VM?`;
  if (!await confirmAction(question)) {
    logs.push({ type: "info", message: `Skipped: ${name}` });
    return listing;
  }
  const remotePath = remoteFiles.joinRemotePath(dir, file.name);
  showProgressLine("Deleting", file.name);
  try {
    await files.remove(remotePath);
    ui.clearLine();
    logs.push({ type: "success", message: `Deleted: ${name} on the VM` });
    logs.push({ type: "info", message: formatEquivalent(remotePath, files.describeRemoval(remotePath)) });
    return { ...listing, files: listing.files.filter(entry => entry.name !== file.name) };
  } catch (err) {
    ui.clearLine();
    logs.push({ type: "error", message: `Delete failed: ${name} - ${displayMessage(err.message)}` });
    return listing;
  }
}
//
/**
 * Browses the files of a VM from its home folder until ESC. The listing stays in memory:
 * a folder is listed again only on a change of folder and after an upload, since on
 * Windows every listing costs seconds. A folder change takes effect only once its
 * listing succeeds, and the trail line is written after the outcome.
 * @param {object} files - Remote files.
 * @param {string} instanceName - VM instance name.
 * @param {{maxItems: number, pageStep: number}} options - Window options.
 * @returns {Promise<void>}
 */
async function navigate(files, instanceName, options) {
  const logs = [];
  let dir = files.home;
  let listing;
  try {
    listing = await listWithProgress(files, dir);
  } catch (err) {
    ui.showError(`Cannot list ${displayName(dir)}: ${displayMessage(err.message)}`);
    return;
  }
  logListingWarning(logs, listing);
  //
  while (true) {
    ui.showOperationLog(logs);
    logs.length = 0;
    const backEnabled = dir !== "/";
    const trailHead = formatTrailHead(instanceName, displayName(dir), backEnabled);
    const result = await showNavigationMenu(instanceName, displayName(dir), listing, { ...options, backEnabled });
    if (result === null) {
      //
      // ESC leaves the cursor on the cleaned question line: the trail goes right there.
      ui.writeInline(`${trailHead} ${ui.formatExitLabel()}\n`);
      return;
    }
    //
    if (result.action === "back" || result.action === "folder") {
      const target = result.action === "back" ? remoteFiles.parentPath(dir) : remoteFiles.joinRemotePath(dir, result.value.name);
      const label = result.action === "back" ? ui.formatBackLabel() : ui.formatFolderLabel(displayName(result.value.name));
      try {
        const next = await listWithProgress(files, target);
        writeTrail(`${trailHead} ${label}`);
        dir = target;
        listing = next;
        logListingWarning(logs, listing);
      } catch (err) {
        writeTrail(`${trailHead} ${label} ${ui.formatRed("✗")}`);
        logs.push({ type: "error", message: `Cannot open ${displayName(target)}: ${displayMessage(err.message)}` });
      }
    } else if (result.action === "delete") {
      writeTrail(`${trailHead} ${ui.formatRed(`DEL [F] ${displayName(result.value.value.name)}`)}`);
      listing = await deleteFile(files, dir, listing, result.value.value, logs);
    } else if (result.action === "file") {
      await downloadFile(files, remoteFiles.joinRemotePath(dir, result.value.name), result.value, logs);
    } else if (result.action === "upload") {
      const uploaded = await uploadFiles(files, instanceName, dir, logs, options);
      if (uploaded > 0 && files.isOpen()) {
        try {
          listing = await listWithProgress(files, dir);
          logListingWarning(logs, listing);
        } catch (err) {
          logs.push({ type: "error", message: `Cannot list ${displayName(dir)}: ${displayMessage(err.message)}` });
        }
      }
    }
    //
    if (!files.isOpen()) {
      ui.showOperationLog(logs);
      ui.showError(`The connection to ${instanceName} closed.`);
      return;
    }
  }
}
//
/**
 * Opens the files of a VM, browses them, and closes the connection whatever happens.
 * It never throws, so the list of VMs stays.
 * @param {object} configuration - Configuration object, with an auth identity.
 * @param {object} instance - Running Linux instance from Compute.listInstances().
 * @param {{maxItems: number, pageStep: number}} options - Window options of the navigator.
 * @returns {Promise<void>}
 */
async function browseInstance(configuration, instance, options) {
  let files = null;
  try {
    files = await openFiles(configuration, instance);
    if (files) {
      await navigate(files, instance.name, options);
    }
  } catch (err) {
    ui.showError(displayMessage(err.message));
    const hint = describeAuthError(err);
    if (hint) {
      ui.showWarning(hint);
    }
  } finally {
    if (files) {
      await files.close();
      if (files.shared) {
        ui.showInfo(`Connection to ${instance.name} closed.`);
      }
    }
  }
}
//
// --- Main command. ---
//
/**
 * Executes the file navigator: lists the running Linux VMs, then browses the chosen one.
 * @param {string} configName - Configuration name.
 */
async function execute(configName) {
  const configuration = await loadConfiguration(configName);
  if (!configuration.auth || !configuration.auth.identity) {
    showMigrationHint(configName);
    return;
  }
  //
  const computeInstance = new Compute(configName);
  ui.showProgress("Listing VM instances");
  let instances;
  try {
    instances = await computeInstance.listInstances();
  } finally {
    ui.clearLine();
  }
  //
  // Windows VMs are reached over RDP, which carries no file transfer of this kind.
  const linux = instances.filter(i => i.status === vmConnect.RUNNING && i.guestOs !== vmConnect.WINDOWS);
  if (linux.length === 0) {
    ui.showWarning("No running Linux VM instances found.");
    return;
  }
  //
  // A broken key pair fails every VM alike: stop before showing the list.
  const problem = await describeKeyProblem(configuration);
  if (problem) {
    ui.showError(problem);
    return;
  }
  //
  const settings = getSettings();
  const listOptions = { maxItems: settings.janitor.maxItems, pageStep: settings.janitor.pageStep };
  const navigatorOptions = { maxItems: settings.storage.maxItems, pageStep: settings.storage.pageStep };
  while (true) {
    const selected = await vmConnect.showRunningVMList(linux, listOptions, "Select VM to browse (type to filter, ESC to exit):");
    if (selected === null) {
      return;
    }
    await browseInstance(configuration, selected, navigatorOptions);
    ui.blankLine();
  }
}
//
module.exports = {
  name: "vmFiles",
  description: "Browse and transfer VM files (SCP)",
  execute
};
