const inquirer = require("inquirer");
const readline = require("readline");
const Compute = require("../GCPUtilities/Compute.js");
const FilterableListPrompt = require("../utils/prompts/filterableList.js");
const { getSettings } = require("../utils/settings.js");
const { loadConfiguration } = require("../utils/configLoader.js");
const { readGcloudIdentity, describeAuthError } = require("../utils/gcpAuth.js");
const gcloud = require("../utils/gcloud.js");
const rdp = require("../utils/rdp.js");
const secrets = require("../utils/secrets.js");
const clipboard = require("../utils/clipboard.js");
const editor = require("../utils/configEditor.js");
const paths = require("../utils/paths.js");
const { showMigrationHint } = require("./auth.js");
const ui = require("../utils/ui.js");
//
// Register custom prompts.
inquirer.registerPrompt("filterableList", FilterableListPrompt);
//
const RUNNING = "RUNNING";
//
// Guest OS of the VMs reached over RDP; every other VM is reached over SSH.
const WINDOWS = "windows";
//
// Exit code of a shell whose last command was interrupted by Ctrl+C.
const INTERRUPTED_EXIT_CODE = 130;
//
// Source range of the IAP TCP forwarding proxies, which the firewall must let in.
const IAP_SOURCE_RANGE = "35.235.240.0/20";
//
// Error codes in gcloud's output when IAP refuses the tunnel: the account lacks the
// tunnel role, or IAP cannot reach the port of the VM. Matched as whole numbers, since
// the same output also carries the random local port, which may contain the digits.
const IAP_NOT_AUTHORIZED = /\b4033\b/;
const IAP_BACKEND_UNREACHABLE = /\b4003\b/;
//
// --- UI: Render and display functions. ---
//
/**
 * Shows the hints for an SSH session that may not have opened.
 * gcloud passes on the exit code of the last remote command and has already printed
 * its own errors, so the code alone cannot tell a failed connection from a remote
 * command that failed: the hints stay conditional.
 * @param {number} code - Exit code of gcloud.
 * @param {boolean} tunnelThroughIap - Whether the session went through IAP.
 */
function showSshFailureHints(code, tunnelThroughIap) {
  ui.showInfo(`gcloud exited with code ${code}.`);
  const hints = [
    "If the connection did not open, check:",
    "  - OS Login: roles/compute.osLogin for the account."
  ];
  if (tunnelThroughIap) {
    hints.push(`  - IAP: roles/iap.tunnelResourceAccessor, and a firewall rule allowing tcp:22 from ${IAP_SOURCE_RANGE}.`);
  } else {
    hints.push("  - Direct: port 22 reachable from your IP (see Update Firewall), or set \"ssh.tunnelThroughIap\".");
  }
  ui.writeInline(ui.formatGray(`${hints.join("\n")}\n`));
}
//
/**
 * Shows the hints for an IAP tunnel to the RDP port that did not open, or closed.
 * gcloud names the cause by its IAP error code when it knows it; otherwise both hints show.
 * @param {string} stderr - Last lines gcloud printed on stderr.
 */
function showRdpFailureHints(stderr) {
  const text = stderr || "";
  const role = "  - IAP: roles/iap.tunnelResourceAccessor for the account, on the project or the VM.";
  const firewall = `  - Firewall: a rule allowing tcp:${rdp.RDP_PORT} from ${IAP_SOURCE_RANGE}, and Remote Desktop enabled on the VM.`;
  const hints = ["If the tunnel did not open or did not stay open, check:"];
  if (IAP_NOT_AUTHORIZED.test(text)) {
    hints.push(role);
  } else if (IAP_BACKEND_UNREACHABLE.test(text)) {
    hints.push(firewall);
  } else {
    hints.push(role, firewall);
  }
  ui.writeInline(ui.formatGray(`${hints.join("\n")}\n`));
}
//
/**
 * Shows why an IAP tunnel did not open. It is the first call that really uses the
 * credentials, so an authentication failure gets its own hint instead of the IAP ones;
 * a missing gcloud carries no stderr and needs no hint beyond its message.
 * @param {Error} err - Error of gcloud.startIapTunnel(), with the stderr tail in err.stderr.
 */
function showTunnelFailure(err) {
  ui.showError(err.message);
  const authHint = describeAuthError(err);
  if (authHint) {
    ui.showWarning(authHint);
    return;
  }
  if (err.stderr) {
    showRdpFailureHints(err.stderr);
  }
}
//
// --- UX: Prompt functions. ---
//
/**
 * Shows the running VM instances as a live-filterable list.
 * The value is the whole instance, because a name is unique only within its zone.
 * The OS column tells which protocol the connection will use, and is searchable.
 * @param {Array} instances - Running instances.
 * @param {{maxItems: number, pageStep: number}} options - Window options.
 * @returns {Promise<object|null>} Selected instance, or null on ESC.
 */
async function showRunningVMList(instances, options) {
  const digits = String(instances.length).length;
  const widths = [
    digits + 1,
    Math.max(...instances.map(inst => inst.name.length)),
    Math.max(...instances.map(inst => inst.zone.length)),
    Math.max(...instances.map(inst => ui.formatGuestOs(inst.guestOs).length))
  ];
  const source = instances.map((inst, i) => ({
    name: ui.formatColumns([`${String(i + 1).padStart(digits)}.`, inst.name, inst.zone, ui.formatGuestOs(inst.guestOs), inst.externalIp || "internal only"], widths),
    value: inst,
    search: `${inst.name} ${inst.zone} ${ui.formatGuestOs(inst.guestOs)}`.toLowerCase()
  }));
  //
  const { selected } = await inquirer.prompt([{
    type: "filterableList",
    name: "selected",
    message: "Select VM to connect (type to filter, ESC to exit):",
    source,
    pageWindow: options.maxItems,
    pageStep: options.pageStep,
    enableBack: false,
    formatLoadMore: ui.formatLoadMore,
    noMatchesText: ui.formatNoMatches
  }]);
  //
  return selected;
}
//
// --- Shared by both protocols. ---
//
/**
 * Resolves the account of an identity whose credentials file does not carry it.
 * @param {string} identity - Identity name.
 * @returns {Promise<string>} The account email.
 * @throws {Error} If the account cannot be determined.
 */
async function resolveAccountLive(identity) {
  ui.showProgress(`Resolving the account of identity "${identity}"`);
  let account;
  try {
    account = await gcloud.resolveActiveAccount(identity);
  } finally {
    ui.clearLine();
  }
  if (!account.includes("@")) {
    throw new Error(`Could not determine the account of identity "${identity}". Run Login again.`);
  }
  return account;
}
//
/**
 * Resolves the account and quota project gcloud runs as, for an SSH session or an IAP tunnel.
 * @param {object} auth - Auth block of the configuration.
 * @returns {Promise<{account: string, quotaProject: string|null}>} The account and its quota project.
 */
async function resolveAccount(auth) {
  const gcloudIdentity = readGcloudIdentity(auth);
  const account = gcloudIdentity.account || await resolveAccountLive(auth.identity);
  return { account, quotaProject: gcloudIdentity.quotaProject };
}
//
// --- SSH session. ---
//
/**
 * Resolves the private key of a configuration and checks it before gcloud runs.
 * @param {object} configuration - Configuration object.
 * @returns {Promise<{sshKeyFile: string|null, problem: string|null}>} The expanded key path, null for gcloud's default, and what is wrong with it.
 */
async function resolveKeyFile(configuration) {
  const keyFile = editor.sshKeyFile(configuration);
  const sshKeyFile = keyFile ? paths.expandHome(keyFile) : null;
  const problem = sshKeyFile ? await gcloud.describeSshKeyProblem(sshKeyFile) : null;
  return { sshKeyFile, problem };
}
//
/**
 * Hands the terminal over to a child process.
 * A prompt may have left stdin in raw mode or reading, and the child must be its only reader.
 */
function releaseTerminal() {
  if (process.stdin.isTTY && process.stdin.isRaw) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
}
//
/**
 * Opens an SSH session on a running Linux VM through gcloud compute ssh.
 * @param {object} configuration - Configuration object, with an auth identity.
 * @param {object} instance - Running instance from Compute.listInstances().
 * @returns {Promise<void>}
 */
async function connectSsh(configuration, instance) {
  const { sshKeyFile, problem } = await resolveKeyFile(configuration);
  if (problem) {
    ui.showError(problem);
    return;
  }
  //
  const tunnelThroughIap = editor.tunnelsThroughIap(configuration);
  if (!tunnelThroughIap && !instance.externalIp) {
    ui.showWarning(`VM "${instance.name}" has no external IP: a direct connection only works from inside its network.`);
    ui.writeInline(ui.formatGray("Turn on IAP with Manage configurations (\"ssh.tunnelThroughIap\") to connect through IAP.\n"));
  }
  //
  const { account, quotaProject } = await resolveAccount(configuration.auth);
  const session = {
    identity: configuration.auth.identity,
    account,
    quotaProject,
    projectId: configuration.defaultProjectId,
    zone: instance.zone,
    instance: instance.name,
    tunnelThroughIap,
    sshKeyFile
  };
  ui.showInfo(`Connecting to ${instance.name} as ${account} (${tunnelThroughIap ? "via IAP tunnel" : "direct"})...`);
  ui.writeInline(ui.formatGray(`Equivalent command: ${gcloud.formatSshCommand(session)}\n`));
  //
  releaseTerminal();
  const { code, signal } = await gcloud.runComputeSsh(session);
  if (code === 0) {
    ui.showSuccess("SSH session closed.");
  } else if (signal || code === INTERRUPTED_EXIT_CODE) {
    ui.showInfo("SSH session interrupted.");
  } else {
    showSshFailureHints(code, tunnelThroughIap);
  }
}
//
// --- RDP session. ---
//
/**
 * Listens for ESC, q or Ctrl+C while the tool waits for an RDP session.
 * After an inquirer prompt stdin is paused, and a keypress listener alone does not
 * resume it: this does what waitForKeypress() does. In raw mode Ctrl+C arrives as a
 * key, not as SIGINT, so it closes the tunnel instead of quitting the tool.
 * @param {function(): void} onCancel - Called on one of the three keys.
 * @returns {function} The keypress listener, to remove with restoreTerminal().
 */
function listenForCancelKeys(onCancel) {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  const onKey = (str, key) => {
    const name = key && key.name;
    const ctrl = Boolean(key && key.ctrl);
    const meta = Boolean(key && key.meta);
    if (name === "escape" || (ctrl && name === "c") || (str === "q" && !ctrl && !meta)) {
      onCancel();
    }
  };
  process.stdin.on("keypress", onKey);
  return onKey;
}
//
/**
 * Gives the terminal back to the prompts after an RDP wait. The listener is removed
 * explicitly: the session usually ends without any key pressed, so a once() would stay.
 * @param {function|null} onKey - Listener from listenForCancelKeys(), or null if none was added.
 */
function restoreTerminal(onKey) {
  if (onKey) {
    process.stdin.removeListener("keypress", onKey);
  }
  releaseTerminal();
}
//
/**
 * Copies the RDP password of a configuration to the clipboard, once the client is open,
 * so a connection that already failed never touches the keychain. Windows App on macOS
 * takes no password from a .rdp file: the user pastes it at the login. A keychain or
 * clipboard error is a warning, and the session goes on without the password.
 * Through IAP the clipboard is cleared as soon as the session starts, so the message says so.
 * @param {string} configName - Configuration name.
 * @param {boolean} clearsOnStart - Whether the caller clears the clipboard when the session starts.
 * @returns {Promise<number|null>} The clipboard change count for clipboard.clearSecret(), or null if nothing was copied.
 */
async function offerRdpPassword(configName, clearsOnStart) {
  if (!secrets.isSupported()) {
    return null;
  }
  let password;
  try {
    password = await secrets.getRdpPassword(configName);
  } catch (err) {
    ui.showWarning(`${err.message} Type the password at the RDP login.`);
    return null;
  }
  if (password === null) {
    return null;
  }
  try {
    const changeCount = await clipboard.copySecret(password);
    const seconds = clipboard.CLEAR_AFTER_MS / 1000;
    const when = clearsOnStart ? `once the session starts, or within ${seconds} seconds` : `in ${seconds} seconds`;
    ui.showInfo(`RDP password copied to the clipboard: paste it with ⌘V at the login. It is cleared ${when}.`);
    return changeCount;
  } catch (err) {
    ui.showWarning(`${err.message} Type the password at the RDP login.`);
    return null;
  }
}
//
/**
 * Opens the IAP tunnel of an RDP session, showing why when it does not open.
 * @param {object} tunnelSpec - IAP tunnel, see gcloud.buildIapTunnelArgs().
 * @returns {Promise<object|null>} The tunnel from gcloud.startIapTunnel(), or null if it did not open.
 */
async function openIapTunnel(tunnelSpec) {
  let tunnel = null;
  let failure = null;
  ui.showProgress("Opening IAP tunnel");
  try {
    tunnel = await gcloud.startIapTunnel(tunnelSpec);
  } catch (err) {
    failure = err;
  } finally {
    ui.clearLine();
  }
  if (failure) {
    showTunnelFailure(failure);
  }
  return tunnel;
}
//
/**
 * Opens an RDP session through an IAP tunnel, and closes the tunnel when the session ends.
 * The client connects to a local relay in front of the tunnel, which tells when the
 * session opens and closes. Everything opened is closed in the finally, whatever happens
 * from the tunnel on: a client that cannot start, a tunnel that drops, ESC.
 * A password copied to the clipboard is cleared once the session counts as started,
 * that is after the login, or at the end; the detached timer of the clipboard stays
 * as a safety net.
 * @param {string} configName - Configuration name, for the RDP password.
 * @param {object} configuration - Configuration object, with an auth identity.
 * @param {object} instance - Running Windows instance from Compute.listInstances().
 * @param {string} username - Windows user name for the .rdp file, possibly empty.
 * @returns {Promise<void>}
 */
async function connectRdpThroughIap(configName, configuration, instance, username) {
  const { account, quotaProject } = await resolveAccount(configuration.auth);
  const tunnelSpec = {
    identity: configuration.auth.identity,
    account,
    quotaProject,
    projectId: configuration.defaultProjectId,
    zone: instance.zone,
    instance: instance.name,
    remotePort: rdp.RDP_PORT
  };
  ui.showInfo(`Connecting to ${instance.name} as ${account} (RDP via IAP tunnel)...`);
  ui.writeInline(ui.formatGray(`Equivalent command: ${gcloud.formatIapTunnelCommand(tunnelSpec)}\n`));
  //
  let tunnel = null;
  let relay = null;
  let onKey = null;
  let outcome = null;
  let droppedExit = null;
  let changeCount = null;
  const controller = new AbortController();
  try {
    tunnel = await openIapTunnel(tunnelSpec);
    if (!tunnel) {
      return;
    }
    relay = await rdp.startRelay(tunnel.port);
    const file = await rdp.writeRdpFile({ instance: instance.name, zone: instance.zone, address: `127.0.0.1:${relay.port}`, username });
    await rdp.openRdpFile(file);
    changeCount = await offerRdpPassword(configName, true);
    //
    // The tunnel exiting on its own ends the wait too. The finally aborts first, so
    // the exit caused by stop() is never taken for a dropped tunnel.
    tunnel.exited.then(exit => {
      if (!controller.signal.aborted) {
        droppedExit = exit;
        controller.abort();
      }
    });
    ui.showInfo("Waiting for the RDP session (ESC to close the tunnel)...");
    onKey = listenForCancelKeys(() => controller.abort());
    //
    // onStarted runs inside a timer: clearSecret() never rejects, so nothing can go unhandled there.
    outcome = await rdp.watchSession(relay, {
      signal: controller.signal,
      onStarted: () => {
        ui.showInfo("RDP session active. Close the RDP window to end it, or press ESC to close the tunnel.");
        const count = changeCount;
        changeCount = null;
        if (count !== null) {
          clipboard.clearSecret(count);
        }
      }
    });
  } finally {
    controller.abort();
    if (changeCount !== null) {
      await clipboard.clearSecret(changeCount);
    }
    if (relay) {
      relay.close();
    }
    if (tunnel) {
      await tunnel.stop();
    }
    restoreTerminal(onKey);
  }
  //
  if (outcome === "ended") {
    ui.showSuccess("RDP session closed, IAP tunnel closed.");
  } else if (outcome === "timeout") {
    ui.showWarning("No RDP session started in time: IAP tunnel closed.");
  } else if (droppedExit) {
    ui.showError("The IAP tunnel closed unexpectedly.");
    if (droppedExit.stderr) {
      ui.writeInline(ui.formatGray(`${droppedExit.stderr}\n`));
    }
    showRdpFailureHints(droppedExit.stderr);
  } else {
    ui.showInfo("IAP tunnel closed.");
  }
}
//
/**
 * Opens an RDP session on a running Windows VM with the system's RDP client:
 * directly to its external IP, or through an IAP tunnel. A saved password is copied
 * to the clipboard once the client is open; directly, the tool returns to the menu
 * at once, and the detached timer of the clipboard clears it.
 * @param {string} configName - Configuration name, for the RDP password.
 * @param {object} configuration - Configuration object, with an auth identity.
 * @param {object} instance - Running Windows instance from Compute.listInstances().
 * @returns {Promise<void>}
 */
async function connectRdp(configName, configuration, instance) {
  // A configuration can be edited by hand: a line break would add lines to the .rdp file.
  const username = editor.rdpUsername(configuration);
  if (editor.validateRdpUsername(username) !== true) {
    ui.showError("rdp.username contains control characters, such as line breaks: fix it with Manage configurations.");
    return;
  }
  if (editor.rdpTunnelsThroughIap(configuration)) {
    await connectRdpThroughIap(configName, configuration, instance, username);
    return;
  }
  //
  // Unlike SSH, where gcloud resolves the address from the VM name, the address goes into the .rdp file.
  if (!instance.externalIp) {
    ui.showError(`VM "${instance.name}" has no external IP: a direct RDP connection has no address to connect to.`);
    ui.writeInline(ui.formatGray("Turn on IAP with Manage configurations (\"rdp.tunnelThroughIap\") to connect through IAP.\n"));
    return;
  }
  const file = await rdp.writeRdpFile({ instance: instance.name, zone: instance.zone, address: instance.externalIp, username });
  await rdp.openRdpFile(file);
  ui.showSuccess(`RDP client opened for ${instance.name} at ${instance.externalIp} (direct).`);
  ui.writeInline(ui.formatGray(`Port ${rdp.RDP_PORT} must be reachable from your IP (see Update Firewall).\n`));
  await offerRdpPassword(configName, false);
}
//
// --- Connection. ---
//
/**
 * Connects to a VM instance as the identity of a configuration: over RDP for a
 * Windows VM, over SSH for any other.
 * Shared with the janitor: it never throws, so the caller keeps its own state.
 * @param {string} configName - Configuration name.
 * @param {{name: string, zone: string, status: string, externalIp: string, guestOs: string}} instance - Instance from Compute.listInstances().
 * @returns {Promise<void>}
 */
async function connectToInstance(configName, instance) {
  try {
    const configuration = await loadConfiguration(configName);
    const auth = configuration.auth;
    if (!auth || !auth.identity) {
      showMigrationHint(configName);
      return;
    }
    const isWindows = instance.guestOs === WINDOWS;
    if (instance.status !== RUNNING) {
      ui.showWarning(`VM "${instance.name}" is ${instance.status}: only running instances accept ${isWindows ? "RDP" : "SSH"}.`);
      return;
    }
    if (isWindows) {
      await connectRdp(configName, configuration, instance);
    } else {
      await connectSsh(configuration, instance);
    }
  } catch (err) {
    ui.showError(err.message);
    const hint = describeAuthError(err);
    if (hint) {
      ui.showWarning(hint);
    }
  }
}
//
// --- Main command. ---
//
/**
 * Executes the connection command: lists the running VMs and connects to the chosen one.
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
  const running = instances.filter(i => i.status === RUNNING);
  if (running.length === 0) {
    ui.showWarning("No running VM instances found.");
    return;
  }
  //
  // A broken key pair fails every Linux VM alike: with no Windows VM to reach over RDP,
  // stop before showing the list. Otherwise connectSsh() stops on a Linux VM only.
  if (!running.some(i => i.guestOs === WINDOWS)) {
    const { problem } = await resolveKeyFile(configuration);
    if (problem) {
      ui.showError(problem);
      return;
    }
  }
  //
  const settings = getSettings();
  const listOptions = { maxItems: settings.janitor.maxItems, pageStep: settings.janitor.pageStep };
  while (true) {
    const selected = await showRunningVMList(running, listOptions);
    if (selected === null) {
      return;
    }
    await connectToInstance(configName, selected);
    ui.blankLine();
  }
}
//
module.exports = {
  name: "vmConnect",
  description: "Connect to a VM (SSH/RDP)",
  execute,
  connectToInstance
};
