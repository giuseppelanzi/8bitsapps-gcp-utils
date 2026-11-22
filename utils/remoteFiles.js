const childProcess = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const gcloud = require("./gcloud.js");
//
// Prefix of the private folder that holds the control socket of a master connection,
// the length of the random suffix fs.mkdtemp() appends to it, and the socket name.
const SOCKET_DIR_PREFIX = "gcpu-";
const MKDTEMP_SUFFIX_LENGTH = 6;
const SOCKET_NAME = "cm";
//
// Longest control socket path. sun_path holds 104 bytes on macOS, the final NUL
// included, and ssh binds the socket first to the path plus "." and 16 characters.
const MAX_CONTROL_PATH = 86;
//
// Exit code of a process ended by each signal the exit handlers take over.
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
//
// Signals handled while a master connection opens. SIGINT is added once it is open:
// while it opens, Ctrl+C ends gcloud and ssh, and the opening fails without ending the tool.
const OPENING_SIGNALS = ["SIGTERM", "SIGHUP"];
//
// Fields printed by find for each entry: type, type of the link target, size, name.
// NUL ends each record, so any name survives.
const LISTING_FORMAT = "%y\\t%Y\\t%s\\t%f\\0";
//
// Characters no copy can carry: the commands of an sftp batch are lines.
const LINE_BREAK_PATTERN = /[\r\n]/;
//
// Characters gcloud.cmd may read again on Windows, after cmd.exe has unescaped them once.
const CMD_UNSAFE_PATTERN = /["%!^]/;
//
// The replacement character: what a name that is not valid UTF-8 decodes to, so the
// copy would ask for a file that does not exist.
const INVALID_UTF8_PATTERN = /\uFFFD/;
//
// Characters Windows refuses in a file name, ":" among them, which would name an
// alternate data stream; and the device names it reserves, whatever the extension.
const WINDOWS_UNSAFE_NAME_PATTERN = /[<>:"/\\|?*\p{Cc}]/u;
const WINDOWS_RESERVED_NAME_PATTERN = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
//
// Characters ssh would split or expand in the value of -o ControlPath.
const CONTROL_PATH_UNSAFE_PATTERN = /[\s%"'\\]/;
//
// Lines of stderr kept for an error message.
const STDERR_LINES = 10;
//
// How often a transfer is measured, and how far back its speed looks.
const PROGRESS_INTERVAL_MS = 1000;
const RATE_WINDOW_MS = 5000;
//
// Output of the size script: the size in bytes, digits only.
const SIZE_PATTERN = /^\d+$/;
//
/**
 * Tells whether OpenSSH can share one connection among many commands on this system.
 * Windows has no ControlMaster, and gcloud uses PuTTY there.
 * @returns {boolean} True on macOS and Linux.
 */
function supportsSharedConnection() {
  return process.platform !== "win32";
}
//
/**
 * Builds the error of a remote command or a copy that failed. The stderr property
 * tells it apart from a local error, even when gcloud or ssh printed nothing.
 * @param {string} message - Error message.
 * @param {string} stderr - What the command printed on stderr, possibly empty.
 * @returns {Error} The error, with a stderr property.
 */
function remoteError(message, stderr) {
  const err = new Error(message);
  err.stderr = stderr || "";
  return err;
}
//
/**
 * Single quotes a value for sh, the shell that runs every remote script.
 * @param {string} value - Value to quote.
 * @returns {string} The quoted value.
 */
function quoteRemoteShell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
//
/**
 * Wraps a script for sh in a command made of base64 and a pipe only. No quote, "%"
 * or backslash reaches the arguments of gcloud or ssh, so the command crosses cmd.exe
 * unharmed on Windows, and the script runs in sh whatever the login shell of the
 * remote user, fish or csh included.
 * @param {string} script - Script for sh.
 * @returns {string} The remote command.
 */
function wrapRemoteScript(script) {
  return `echo ${Buffer.from(script, "utf8").toString("base64")} | base64 -d | sh`;
}
//
/**
 * Builds the script that lists a remote folder. -H follows the folder itself when it is
 * a link; its entries are never followed, so a broken link or a loop prints N or L as
 * the type of its target instead of an error: find fails only on the folder itself.
 * @param {string} dir - Absolute remote folder.
 * @returns {string} Script for sh.
 */
function buildListingScript(dir) {
  return `find -H ${quoteRemoteShell(dir)} -mindepth 1 -maxdepth 1 -printf '${LISTING_FORMAT}'`;
}
//
/**
 * Builds the script that deletes one remote file. Neither -r nor -f: a folder is never
 * deleted, and a file gone meanwhile is an error. rm reads no terminal, so it never asks
 * about a write-protected file: the permission of the folder decides, as always.
 * @param {string} remotePath - Absolute remote path.
 * @returns {string} Script for sh.
 */
function buildRemoveScript(remotePath) {
  return `rm -- ${quoteRemoteShell(remotePath)}`;
}
//
/**
 * Builds the script that prints the size of one remote file, with the same find as the
 * listing. The path is absolute, so find never takes it for an option.
 * @param {string} remotePath - Absolute remote path.
 * @returns {string} Script for sh.
 */
function buildSizeScript(remotePath) {
  return `find ${quoteRemoteShell(remotePath)} -maxdepth 0 -printf '%s'`;
}
//
/**
 * Reads the output of the size script. A run that failed, or printed anything but
 * digits, is an error: Number("") is 0, so a missing file or a lost connection would
 * otherwise read as an empty file.
 * @param {{code: number|null, stdout: Buffer, stderr: string}} result - Result of the size script.
 * @returns {number} The size in bytes.
 * @throws {Error} If the size cannot be read; err.stderr carries why.
 */
function parseSize(result) {
  const text = result.stdout.toString("utf8").trim();
  if (result.code !== 0 || !SIZE_PATTERN.test(text)) {
    throw remoteError(result.stderr || `Reading the size failed with code ${result.code}.`, result.stderr);
  }
  return Number(text);
}
//
/**
 * Measures a transfer once a second, the first time after one second, and never twice
 * at once: the next reading is scheduled only when the last one is over.
 *
 * A reading is trusted from the first one that differs from the size before the copy:
 * until the copy opens the file again, an overwrite still reads the old one. read()
 * returns the bytes or throws; a failure before the first trusted reading reports the
 * time alone, a failure after it skips the round. Without read, every round reports the
 * time alone. The speed spans the last trusted reading and the newest one at least
 * RATE_WINDOW_MS older, or the oldest when none is that old: a reading can take longer
 * than the window, when it queues behind the upload on the shared connection. It is
 * null while there is only one trusted reading.
 * @param {function(): Promise<number>|null} read - Reads the bytes copied so far; null when they cannot be measured.
 * @param {{total?: number|null, previous?: number|null, onProgress: function(object): void}} options - Size of the file, size before the copy (null when absent), and the callback, which gets {bytes, total, rate, elapsedMs}, bytes and rate null when unknown.
 * @returns {{stop: function(): void}} How to stop the measure; a reading still running is then dropped.
 */
function watchTransfer(read, options) {
  const total = options.total === undefined ? null : options.total;
  const previous = options.previous === undefined ? null : options.previous;
  const startedAt = Date.now();
  const samples = [];
  let trusted = false;
  let stopped = false;
  let timer = null;
  //
  const report = (bytes, now) => {
    let rate = null;
    if (bytes !== null && samples.length > 1) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      rate = Math.max(0, (last.bytes - first.bytes) / ((last.time - first.time) / 1000));
    }
    options.onProgress({ bytes, total, rate, elapsedMs: now - startedAt });
  };
  //
  const round = async () => {
    let bytes = null;
    let failed = false;
    if (read) {
      try {
        bytes = await read();
      } catch {
        failed = true;
      }
    }
    if (stopped) {
      return;
    }
    const now = Date.now();
    if (failed && trusted) {
      schedule();
      return;
    }
    if (!failed && bytes !== null && (trusted || bytes !== previous)) {
      trusted = true;
      samples.push({ time: now, bytes });
      while (samples.length > 2 && samples[1].time <= now - RATE_WINDOW_MS) {
        samples.shift();
      }
      report(bytes, now);
    } else {
      report(null, now);
    }
    schedule();
  };
  //
  // A callback that throws ends the measure, never the copy.
  const schedule = () => {
    if (!stopped) {
      timer = setTimeout(() => { round().catch(() => {}); }, PROGRESS_INTERVAL_MS);
      timer.unref();
    }
  };
  schedule();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    }
  };
}
//
/**
 * Reads the size of a local file.
 * @param {string} localPath - Local path.
 * @returns {Promise<number|null>} The size, or null if it cannot be read.
 */
async function localSize(localPath) {
  try {
    return (await fsp.stat(localPath)).size;
  } catch {
    return null;
  }
}
//
/**
 * Parses the output of the listing script. Folders and links to folders are folders;
 * files and links to files are files, a link without a size of its own. Broken links,
 * loops and special files are only named in others, so a copy never overwrites them.
 * @param {Buffer|string} output - Output of the listing script.
 * @returns {{folders: Array<{name: string, link: boolean}>, files: Array<{name: string, size: number|null, link: boolean}>, others: string[]}} The entries, each list sorted by name.
 */
function parseListing(output) {
  const folders = [];
  const files = [];
  const others = [];
  for (const record of String(output).split("\0")) {
    const fields = record.split("\t");
    if (fields.length < 4) {
      continue;
    }
    const [type, targetType, size] = fields;
    const name = fields.slice(3).join("\t");
    if (!name) {
      continue;
    }
    const link = type === "l";
    const kind = link ? targetType : type;
    if (kind === "d") {
      folders.push({ name, link });
    } else if (kind === "f") {
      files.push({ name, size: link ? null : Number(size), link });
    } else {
      others.push(name);
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  folders.sort(byName);
  files.sort(byName);
  others.sort((a, b) => a.localeCompare(b));
  return { folders, files, others };
}
//
/**
 * Reads the home folder printed by pwd.
 * @param {Buffer|string} output - Output of pwd.
 * @param {string} stderr - What the command printed on stderr.
 * @returns {string} The absolute home folder.
 * @throws {Error} If the output is not an absolute path.
 */
function parseHome(output, stderr) {
  const home = String(output).replace(/\r?\n$/, "");
  if (!home.startsWith("/")) {
    throw remoteError(stderr || "The home folder of the remote user could not be read.", stderr);
  }
  return home;
}
//
/**
 * Returns the parent of an absolute remote folder.
 * @param {string} dir - Absolute remote folder.
 * @returns {string} The parent folder; "/" for "/" itself.
 */
function parentPath(dir) {
  const trimmed = dir.length > 1 ? dir.replace(/\/+$/, "") : dir;
  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "/" : trimmed.slice(0, index);
}
//
/**
 * Joins an absolute remote folder and an entry name.
 * @param {string} dir - Absolute remote folder.
 * @param {string} name - Entry name, without "/".
 * @returns {string} The absolute path of the entry.
 */
function joinRemotePath(dir, name) {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}
//
/**
 * Double quotes a path for a command of an sftp batch, for the source and the
 * destination of get and put alike. Inside double quotes makeargv() of sftp turns \"
 * into a quote, keeps \\ for the glob that follows, and escapes ?, [ and * itself, so
 * the source is matched as it is; on the destination, which is not globbed,
 * undo_glob_escape() turns \\ back into one backslash.
 * @param {string} value - Absolute path.
 * @returns {string} The quoted path.
 */
function quoteSftpPath(value) {
  return `"${String(value).replace(/[\\"]/g, "\\$&")}"`;
}
//
/**
 * Tells why a name or a path cannot be copied, if it cannot.
 * @param {string} value - File name or path, as it reaches sftp or gcloud.
 * @param {boolean} shared - Whether the copy goes through sftp (true) or gcloud.cmd (false).
 * @returns {string|null} The reason, or null if it can be copied.
 */
function describeUntransferableName(value, shared) {
  if (LINE_BREAK_PATTERN.test(value)) {
    return "it contains a line break";
  }
  if (INVALID_UTF8_PATTERN.test(value)) {
    return "its name is not valid UTF-8";
  }
  if (!shared && CMD_UNSAFE_PATTERN.test(value)) {
    return "it contains \", %, ! or ^, which do not survive gcloud.cmd on Windows";
  }
  return null;
}
//
/**
 * Tells why a remote file name cannot become a local one, if it cannot. A Linux name may
 * hold what this system reads as a path: ".." anywhere, and on Windows "\\" and ":" too,
 * which could write outside the local folder or into an alternate data stream.
 * @param {string} name - File name, as listed on the VM.
 * @param {string} [platform] - Local platform, process.platform by default.
 * @returns {string|null} The reason, or null if it is a plain file name here.
 */
function describeUnsafeLocalName(name, platform = process.platform) {
  const windows = platform === "win32";
  const pathModule = windows ? path.win32 : path.posix;
  if (name === "." || name === ".." || pathModule.basename(name) !== name) {
    return "its name is not a plain file name on this system";
  }
  if (windows && (WINDOWS_UNSAFE_NAME_PATTERN.test(name) || WINDOWS_RESERVED_NAME_PATTERN.test(name) || /[. ]$/.test(name))) {
    return "Windows does not accept its name";
  }
  return null;
}
//
/**
 * Runs a local program with its output captured.
 * @param {string} command - Program name.
 * @param {string[]} args - Arguments.
 * @param {string} [input] - Text for stdin; stdin is closed when absent.
 * @returns {Promise<{code: number|null, signal: string|null, stdout: Buffer, stderr: string}>} How it exited, and its output (stderr trimmed to its last lines).
 */
function runProcess(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    const chunks = [];
    let stderrText = "";
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderrText += chunk; });
    child.on("error", err => {
      reject(err.code === "ENOENT" ? new Error(`${command} is not installed or not in PATH: the OpenSSH client is needed to browse the files of a VM.`) : err);
    });
    child.on("close", (code, signal) => resolve({ code, signal, stdout: Buffer.concat(chunks), stderr: gcloud.tailLines(stderrText, STDERR_LINES) }));
    if (input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });
}
//
/**
 * Installs the handlers that close a master connection when the tool ends abnormally.
 * The cleanup is synchronous, as an exit handler requires, and runs once: a signal
 * handler calls process.exit(), which fires "exit" again.
 * @param {string} controlPath - Path of the control socket.
 * @param {string} dir - Private folder of the socket.
 * @returns {{listen: function(string[]): void, dispose: function(): void}} How to add signals, and how to remove every handler.
 */
function createExitGuard(controlPath, dir) {
  let done = false;
  const listeners = [];
  const cleanUp = () => {
    if (done) {
      return;
    }
    done = true;
    gcloud.stopSshMasterSync(controlPath);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Nothing more can be done while the process exits.
    }
  };
  const add = (event, listener) => {
    process.on(event, listener);
    listeners.push([event, listener]);
  };
  add("exit", cleanUp);
  return {
    listen(signals) {
      for (const signal of signals) {
        add(signal, () => {
          cleanUp();
          process.exit(SIGNAL_EXIT_CODES[signal]);
        });
      }
    },
    dispose() {
      done = true;
      for (const [event, listener] of listeners) {
        process.removeListener(event, listener);
      }
      listeners.length = 0;
    }
  };
}
//
/**
 * Opens the shared connection of macOS and Linux: a master connection through gcloud,
 * then ssh and sftp through its control socket, which lives in a private folder made by
 * fs.mkdtemp(). Any failure while opening closes everything before it is thrown.
 * SIGINT is ignored until the connection is open, so Ctrl+C fails the opening only.
 * @param {object} session - SSH session.
 * @param {{timeoutMs?: number}} options - Startup timeout of the master connection.
 * @returns {Promise<{home: string, transport: object}>} The home folder and the transport.
 */
async function openSharedTransport(session, options) {
  const expected = path.join(os.tmpdir(), `${SOCKET_DIR_PREFIX}${"x".repeat(MKDTEMP_SUFFIX_LENGTH)}`, SOCKET_NAME);
  if (Buffer.byteLength(expected) > MAX_CONTROL_PATH) {
    throw new Error(`The temporary folder "${os.tmpdir()}" is too long for an SSH control socket (at most ${MAX_CONTROL_PATH} bytes in all): set TMPDIR to a shorter folder.`);
  }
  if (CONTROL_PATH_UNSAFE_PATTERN.test(expected)) {
    throw new Error(`The temporary folder "${os.tmpdir()}" contains spaces, quotes, "%" or backslashes, which ssh would split or expand in the path of its control socket: set TMPDIR to another folder.`);
  }
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), SOCKET_DIR_PREFIX));
  const controlPath = path.join(dir, SOCKET_NAME);
  const controlOptions = gcloud.buildControlOptions(controlPath);
  const guard = createExitGuard(controlPath, dir);
  guard.listen(OPENING_SIGNALS);
  let interrupted = false;
  const onInterrupt = () => { interrupted = true; };
  process.on("SIGINT", onInterrupt);
  let master = null;
  let open = false;
  let closing = null;
  const transport = {
    run: script => runProcess("ssh", [...controlOptions, "-T", gcloud.CONTROL_HOST, wrapRemoteScript(script)]),
    copy: (transfer, localPath) => {
      const line = transfer.direction === "download"
        ? `get ${quoteSftpPath(transfer.remotePath)} ${quoteSftpPath(localPath)}`
        : `put ${quoteSftpPath(localPath)} ${quoteSftpPath(transfer.remotePath)}`;
      return runProcess("sftp", ["-q", "-b", "-", ...controlOptions, gcloud.CONTROL_HOST], `${line}\n`);
    },
    isOpen: () => open,
    close: () => {
      if (!closing) {
        closing = (async () => {
          open = false;
          try {
            if (master) {
              await master.stop();
            }
            await fsp.rm(dir, { recursive: true, force: true });
          } catch {
            // The exit guard still removes the folder when the tool exits.
            return;
          }
          guard.dispose();
        })();
      }
      return closing;
    }
  };
  try {
    master = await gcloud.startSshMaster(session, controlPath, { timeoutMs: options.timeoutMs });
    open = true;
    master.exited.then(() => { open = false; });
    const result = await transport.run("pwd");
    if (result.code !== 0) {
      throw remoteError(result.stderr || `Reading the home folder failed with code ${result.code}.`, result.stderr);
    }
    const home = parseHome(result.stdout, result.stderr);
    process.removeListener("SIGINT", onInterrupt);
    guard.listen(["SIGINT"]);
    return { home, transport };
  } catch (err) {
    process.removeListener("SIGINT", onInterrupt);
    await transport.close();
    err.interrupted = Boolean(err.interrupted || interrupted);
    throw err;
  }
}
//
/**
 * Opens the transport of Windows, where every operation runs gcloud on its own. The
 * first command is interactive, so keys, host keys and passphrases can be asked.
 * @param {object} session - SSH session.
 * @param {string} localDir - Local folder of the copies.
 * @returns {Promise<{home: string, transport: object}>} The home folder and the transport.
 */
async function openDirectTransport(session, localDir) {
  const transport = {
    run: script => gcloud.runGcloudAs(session, gcloud.buildRemoteCommandArgs(session, wrapRemoteScript(script))),
    copy: transfer => gcloud.runGcloudAs(session, gcloud.buildScpArgs(session, transfer), { cwd: localDir }),
    isOpen: () => true,
    close: async () => {}
  };
  const result = await gcloud.runGcloudAs(session, gcloud.buildRemoteCommandArgs(session, wrapRemoteScript("pwd")), { interactive: true });
  if (result.code !== 0) {
    const reason = result.signal ? `signal ${result.signal}` : `code ${result.code}`;
    const err = remoteError(result.stderr || `gcloud exited with ${reason}.`, result.stderr);
    err.interrupted = result.interrupted;
    throw err;
  }
  return { home: parseHome(result.stdout, result.stderr), transport };
}
//
/**
 * Opens the files of a VM instance, as the identity of the session: through one shared
 * connection on macOS and Linux, through one gcloud command per operation on Windows.
 * @param {object} session - SSH session: identity, account, quotaProject, projectId, zone, instance, tunnelThroughIap, sshKeyFile.
 * @param {{shared?: boolean, localDir?: string, timeoutMs?: number}} [options] - Mode (supportsSharedConnection() by default), local folder (the working directory by default), startup timeout.
 * @returns {Promise<object>} The remote files: shared, home, list(), remove(), describeRemoval(), download(), upload(), describeTransfer(), isOpen(), close().
 * @throws {Error} If the connection does not open; err.stderr is set when gcloud or ssh failed, err.interrupted on Ctrl+C.
 */
async function openRemoteFiles(session, options = {}) {
  const shared = options.shared === undefined ? supportsSharedConnection() : Boolean(options.shared);
  const localDir = options.localDir || process.cwd();
  const { home, transport } = shared ? await openSharedTransport(session, options) : await openDirectTransport(session, localDir);
  //
  /**
   * Lists a remote folder.
   * @param {string} dir - Absolute remote folder.
   * @returns {Promise<{folders: Array, files: Array, others: string[], warning: string|null}>} The entries, and what find reported on a partial listing.
   * @throws {Error} If the folder cannot be read; err.stderr carries why.
   */
  async function list(dir) {
    const result = await transport.run(buildListingScript(dir));
    const listing = parseListing(result.stdout);
    const failed = result.code !== 0;
    const empty = listing.folders.length + listing.files.length + listing.others.length === 0;
    if (failed && empty) {
      throw remoteError(result.stderr || `Listing ${dir} failed with code ${result.code}.`, result.stderr);
    }
    return { ...listing, warning: failed ? (result.stderr || `The listing of ${dir} is partial.`) : null };
  }
  //
  /**
   * Starts measuring a copy. A download reads the local file; an upload reads the remote
   * one through the shared connection, and cannot be measured without it, since every
   * reading would then be a gcloud command of some seconds. A size that cannot be read
   * is null, so the copy itself still reports why the file is missing.
   * @param {{direction: string, remotePath: string}} transfer - Transfer.
   * @param {string} localPath - Local path of the copy.
   * @param {{total?: number|null, previous?: number|null, onProgress: function(object): void}} options - Remote size for a download, remote size before the copy for an upload, and the callback.
   * @returns {Promise<{stop: function(): void}>} The measure, see watchTransfer().
   */
  async function startMeasure(transfer, localPath, options) {
    if (transfer.direction === "download") {
      const previous = await localSize(localPath);
      const read = async () => (await fsp.stat(localPath)).size;
      return watchTransfer(read, { total: options.total, previous, onProgress: options.onProgress });
    }
    const total = await localSize(localPath);
    const read = shared ? async () => parseSize(await transport.run(buildSizeScript(transfer.remotePath))) : null;
    return watchTransfer(read, { total, previous: options.previous, onProgress: options.onProgress });
  }
  //
  /**
   * Copies one file, after checking that its paths can be carried. With onProgress the
   * copy is measured, and the measure stops before the copy resolves.
   * @param {{direction: string, remotePath: string, localName: string}} transfer - Transfer, see gcloud.buildScpArgs().
   * @param {{total?: number|null, previous?: number|null, onProgress?: function(object): void}} [options] - Measure, see startMeasure().
   * @returns {Promise<void>}
   * @throws {Error} If a path cannot be carried, or the copy fails; err.stderr is set in the second case.
   */
  async function copy(transfer, options = {}) {
    const unsafe = describeUnsafeLocalName(transfer.localName);
    if (unsafe) {
      throw new Error(`"${transfer.localName}" cannot be copied: ${unsafe}.`);
    }
    const localPath = path.join(localDir, transfer.localName);
    const checked = shared ? [transfer.remotePath, localPath] : [transfer.remotePath, transfer.localName];
    for (const value of checked) {
      const reason = describeUntransferableName(value, shared);
      if (reason) {
        throw new Error(`"${transfer.localName}" cannot be copied: ${reason}.`);
      }
    }
    const measure = options.onProgress ? await startMeasure(transfer, localPath, options) : null;
    let result;
    try {
      result = await transport.copy(transfer, localPath);
    } finally {
      if (measure) {
        measure.stop();
      }
    }
    if (result.code !== 0) {
      throw remoteError(result.stderr || `The copy failed with code ${result.code}.`, result.stderr);
    }
  }
  //
  /**
   * Deletes one remote file, or the link itself for a link. Any name the shell can quote
   * passes, line breaks included, since the script travels in base64; only a name that
   * is not valid UTF-8 is refused, as it would name another file.
   * @param {string} remotePath - Absolute remote path.
   * @returns {Promise<void>}
   * @throws {Error} If the name is not valid UTF-8, or rm fails; err.stderr is set in the second case.
   */
  async function remove(remotePath) {
    if (INVALID_UTF8_PATTERN.test(remotePath)) {
      throw new Error(`"${path.posix.basename(remotePath)}" cannot be deleted: its name is not valid UTF-8.`);
    }
    const result = await transport.run(buildRemoveScript(remotePath));
    if (result.code !== 0) {
      throw remoteError(result.stderr || `Removing ${remotePath} failed with code ${result.code}.`, result.stderr);
    }
  }
  //
  return {
    shared,
    home,
    list,
    remove,
    describeRemoval: remotePath => gcloud.formatRemoteCommand(session, buildRemoveScript(remotePath)),
    download: (remotePath, localName, options) => copy({ direction: "download", remotePath, localName }, options),
    upload: (localName, remotePath, options) => copy({ direction: "upload", remotePath, localName }, options),
    describeTransfer: transfer => gcloud.formatScpCommand(session, transfer),
    isOpen: transport.isOpen,
    close: transport.close
  };
}
//
module.exports = {
  supportsSharedConnection,
  openRemoteFiles,
  wrapRemoteScript,
  quoteRemoteShell,
  quoteSftpPath,
  buildListingScript,
  buildRemoveScript,
  buildSizeScript,
  parseSize,
  watchTransfer,
  parseListing,
  parentPath,
  joinRemotePath,
  describeUntransferableName,
  describeUnsafeLocalName
};
