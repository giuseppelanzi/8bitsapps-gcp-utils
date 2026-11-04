const inquirer = require("inquirer");
const Compute = require("../GCPUtilities/Compute.js");
const FilterableListPrompt = require("../utils/prompts/filterableList.js");
const { getSettings } = require("../utils/settings.js");
const { loadConfiguration } = require("../utils/configLoader.js");
const { readGcloudIdentity, describeAuthError } = require("../utils/gcpAuth.js");
const gcloud = require("../utils/gcloud.js");
const { showMigrationHint } = require("./auth.js");
const ui = require("../utils/ui.js");
//
// Register custom prompts.
inquirer.registerPrompt("filterableList", FilterableListPrompt);
//
const RUNNING = "RUNNING";
//
// Exit code of a shell whose last command was interrupted by Ctrl+C.
const INTERRUPTED_EXIT_CODE = 130;
//
// Source range of the IAP TCP forwarding proxies, which the firewall must let in.
const IAP_SOURCE_RANGE = "35.235.240.0/20";
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
// --- UX: Prompt functions. ---
//
/**
 * Shows the running VM instances as a live-filterable list.
 * The value is the whole instance, because a name is unique only within its zone.
 * @param {Array} instances - Running instances.
 * @param {{maxItems: number, pageStep: number}} options - Window options.
 * @returns {Promise<object|null>} Selected instance, or null on ESC.
 */
async function showRunningVMList(instances, options) {
  const digits = String(instances.length).length;
  const widths = [
    digits + 1,
    Math.max(...instances.map(inst => inst.name.length)),
    Math.max(...instances.map(inst => inst.zone.length))
  ];
  const source = instances.map((inst, i) => ({
    name: ui.formatColumns([`${String(i + 1).padStart(digits)}.`, inst.name, inst.zone, inst.externalIp || "internal only"], widths),
    value: inst,
    search: `${inst.name} ${inst.zone}`.toLowerCase()
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
// --- SSH session. ---
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
 * Opens an SSH session on a VM instance as the identity of a configuration.
 * Shared with the janitor: it never throws, so the caller keeps its own state.
 * @param {string} configName - Configuration name.
 * @param {{name: string, zone: string, status: string, externalIp: string}} instance - Instance from Compute.listInstances().
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
    if (instance.status !== RUNNING) {
      ui.showWarning(`VM "${instance.name}" is ${instance.status}: only running instances accept SSH.`);
      return;
    }
    //
    const tunnelThroughIap = Boolean(configuration.ssh && configuration.ssh.tunnelThroughIap);
    if (!tunnelThroughIap && !instance.externalIp) {
      ui.showWarning(`VM "${instance.name}" has no external IP: a direct connection only works from inside its network.`);
      ui.writeInline(ui.formatGray("Set \"ssh\": { \"tunnelThroughIap\": true } in the configuration to connect through IAP.\n"));
    }
    //
    const gcloudIdentity = readGcloudIdentity(auth);
    const account = gcloudIdentity.account || await resolveAccountLive(auth.identity);
    const session = {
      identity: auth.identity,
      account,
      quotaProject: gcloudIdentity.quotaProject,
      projectId: configuration.defaultProjectId,
      zone: instance.zone,
      instance: instance.name,
      tunnelThroughIap
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
 * Executes the SSH command: lists the running VMs and connects to the chosen one.
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
  name: "vmSsh",
  description: "Connect to a VM (SSH)",
  execute,
  connectToInstance
};
