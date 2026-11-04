const inquirer = require("inquirer");
const ListWithEscapePrompt = require("../utils/prompts/listWithEscape.js");
const InputWithEscapePrompt = require("../utils/prompts/inputWithEscape.js");
const configLoader = require("../utils/configLoader.js");
const editor = require("../utils/configEditor.js");
const paths = require("../utils/paths.js");
const gcpAuth = require("../utils/gcpAuth.js");
const authCommand = require("./auth.js");
const ui = require("../utils/ui.js");
//
// Register custom prompts, so the module also works when init.js imports it.
inquirer.registerPrompt("listWithEscape", ListWithEscapePrompt);
inquirer.registerPrompt("inputWithEscape", InputWithEscapePrompt);
//
// Value of the "+ New identity" row: a Symbol cannot collide with an identity name.
const NEW_IDENTITY = Symbol("newIdentity");
//
/**
 * Thrown by a wizard question when the user presses ESC.
 */
class WizardCancelled extends Error {}
//
// --- UI: Render and display functions. ---
//
/**
 * Prints the summary of a configuration, one row per field.
 * @param {Array<{label: string, value: string, before: string, changed: boolean}>} rows - Rows from configEditor.describeFields().
 * @param {boolean} highlightChanges - Whether to show changed fields as "old → new".
 */
function showSummary(rows, highlightChanges) {
  const width = Math.max(...rows.map(row => row.label.length)) + 1;
  for (const row of rows) {
    const value = highlightChanges && row.changed
      ? ui.formatChange(row.before, row.value)
      : row.value || ui.formatGray("(none)");
    ui.writeInline(`  ${ui.formatColumns([`${row.label}:`, value], [width])}\n`);
  }
}
//
/**
 * Warns that other configurations share the identity but log in differently.
 * @param {string} identity - Identity chosen.
 * @param {Array<{name: string, account: string, impersonateServiceAccount: string}>} conflicts - Conflicting configurations.
 */
function showIdentityConflicts(identity, conflicts) {
  const others = conflicts
    .map(c => `${c.name} (account ${c.account || "not set"}, ${c.impersonateServiceAccount ? `impersonating ${c.impersonateServiceAccount}` : "no impersonation"})`)
    .join(", ");
  ui.showWarning(`Identity "${identity}" is also used by ${others}.`);
  ui.showWarning("One identity holds one login: logging in for this configuration switches the others too. Use another identity instead.");
}
//
// --- Identities: login state and defaults. ---
//
/**
 * Describes the login state of an identity.
 * @param {string} identity - Identity name.
 * @returns {{account: string|null, status: string}} Account found in the credentials, and a short status.
 */
function describeLoginState(identity) {
  const info = gcpAuth.readAdcInfo(identity);
  if (!info.exists) {
    return { account: null, status: "not logged in" };
  }
  if (info.corrupt) {
    return { account: null, status: "unreadable credentials" };
  }
  return { account: info.account, status: "logged in" };
}
//
/**
 * Returns the account and service account stored in the credentials of an identity.
 * @param {string} identity - Identity name.
 * @returns {{account: string, impersonateServiceAccount: string}|null} Values, or null without readable credentials.
 */
function adcAuthDefaults(identity) {
  const info = gcpAuth.readAdcInfo(identity);
  if (!info.exists || info.corrupt) {
    return null;
  }
  return { account: info.account || "", impersonateServiceAccount: info.impersonatedServiceAccount || "" };
}
//
/**
 * Picks the defaults of the account and impersonation questions.
 * A configuration keeps its own values; a new identity choice takes the values of the
 * other configurations using it, or else those written in its credentials.
 * @param {{identities: Map, identity: string, originalAuth: object, selfName: string|null}} context - Wizard state.
 * @returns {{account: string, impersonateServiceAccount: string}} Defaults.
 */
function authDefaults({ identities, identity, originalAuth, selfName }) {
  if (identity === editor.asText(originalAuth.identity)) {
    return {
      account: editor.asText(originalAuth.account),
      impersonateServiceAccount: editor.asText(originalAuth.impersonateServiceAccount)
    };
  }
  return editor.siblingAuthDefaults(identities, identity, selfName)
    || adcAuthDefaults(identity)
    || { account: "", impersonateServiceAccount: "" };
}
//
// --- UX: Prompt functions. ---
//
/**
 * Shows a choice list. Back and delete are off unless the options turn them on,
 * since listWithEscape enables both by default.
 * @param {object} options - Prompt options: message, choices, default, and optionally enableBack or deleteFilter.
 * @returns {Promise<*>} Selected value, null on ESC, or an action object for back and delete.
 */
async function askChoice(options) {
  const { selected } = await inquirer.prompt([{
    type: "listWithEscape",
    name: "selected",
    enableBack: false,
    deleteFilter: () => false,
    ...options
  }]);
  return selected;
}
//
/**
 * Asks a yes or no question.
 * @param {string} message - Question.
 * @param {boolean} defaultValue - Answer preselected.
 * @returns {Promise<boolean|null>} The answer, or null on ESC.
 */
async function askYesNo(message, defaultValue) {
  return askChoice({
    message,
    choices: [
      { name: "1. Yes", value: true },
      { name: "2. No", value: false }
    ],
    default: defaultValue ? 0 : 1
  });
}
//
/**
 * Turns an ESC answer into a cancellation of the whole wizard.
 * @param {*} value - Answer of a prompt.
 * @returns {*} The same answer.
 * @throws {WizardCancelled} If the answer is null.
 */
function orCancel(value) {
  if (value === null) {
    throw new WizardCancelled();
  }
  return value;
}
//
/**
 * Asks a wizard text question. ENTER keeps the default, "-" clears it, ESC cancels the wizard.
 * An empty default is passed as undefined, otherwise inquirer prints "()".
 * @param {{message: string, default?: string, validate: function}} question - Question.
 * @returns {Promise<string>} The normalized answer.
 * @throws {WizardCancelled} On ESC.
 */
async function askText(question) {
  const { value } = await inquirer.prompt([{
    type: "inputWithEscape",
    name: "value",
    message: question.message,
    default: question.default || undefined,
    filter: editor.normalizeAnswer,
    validate: question.validate
  }]);
  return orCancel(value);
}
//
/**
 * Asks the identity of the configuration, among the known ones or a new one.
 * @param {Map} identities - Result of configLoader.listIdentities().
 * @param {string} current - Identity of the configuration, empty for none.
 * @param {string} configName - Name of the configuration, suggested for a new identity.
 * @returns {Promise<string>} Identity chosen.
 * @throws {WizardCancelled} On ESC.
 */
async function askIdentity(identities, current, configName) {
  const names = [...identities.keys()];
  const canSuggest = !current && paths.isValidName(configName) && !editor.isNameTaken(names, configName);
  const askNew = async () => {
    const answer = await askText({
      message: "New identity name:",
      default: canSuggest ? configName : undefined,
      validate: editor.validateIdentityName
    });
    const existing = editor.findName(names, answer);
    if (existing) {
      ui.showInfo(`Identity "${existing}" already exists: using it.`);
      return existing;
    }
    return answer;
  };
  if (names.length === 0) {
    return askNew();
  }
  //
  const rows = names.map(name => {
    const entry = identities.get(name);
    const state = describeLoginState(name);
    const named = entry.configs.find(c => c.account);
    const usage = entry.hasConfiguration ? `used by ${entry.configs.map(c => c.name).join(", ")}` : "no configuration";
    return { name, account: (named && named.account) || state.account || "", details: `${state.status}, ${usage}` };
  });
  const widths = [
    String(rows.length).length + 1,
    Math.max(...rows.map(row => row.name.length)),
    Math.max(...rows.map(row => row.account.length))
  ];
  const choices = rows.map((row, i) => ({
    name: ui.formatColumns([`${i + 1}.`, row.name, row.account, ui.formatGray(row.details)], widths),
    value: row.name,
    short: row.name
  }));
  choices.push({ name: ui.formatNewChoice("New identity"), value: NEW_IDENTITY });
  //
  const preselected = current || editor.findName(names, configName);
  const index = names.indexOf(preselected);
  const selected = orCancel(await askChoice({
    message: "Identity (configurations sharing one share its login, ESC to discard):",
    choices,
    default: index >= 0 ? index : names.length
  }));
  return selected === NEW_IDENTITY ? askNew() : selected;
}
//
/**
 * Asks the quota project, if it applies.
 * Without impersonation it is always asked; with impersonation it is ignored, so it is
 * asked only to let an existing value be removed.
 * @param {{originalAuth: object, impersonateServiceAccount: string, defaultProjectId: string}} context - Wizard state.
 * @returns {Promise<string|undefined>} The answer, or undefined when not asked.
 * @throws {WizardCancelled} On ESC.
 */
async function askQuotaProject({ originalAuth, impersonateServiceAccount, defaultProjectId }) {
  const current = editor.asText(originalAuth.quotaProject);
  if (impersonateServiceAccount) {
    if (!current) {
      return undefined;
    }
    return askText({
      message: "Quota project (ignored while impersonating, \"-\" to remove):",
      default: current,
      validate: editor.validateOptionalProjectId
    });
  }
  //
  // A configuration that had no identity, or stops impersonating, now bills user credentials.
  const needsOne = !originalAuth.identity || Boolean(originalAuth.impersonateServiceAccount);
  return askText({
    message: "Quota project billed for API calls (optional):",
    default: current || (needsOne ? defaultProjectId : ""),
    validate: editor.validateOptionalProjectId
  });
}
//
/**
 * Asks every question of the wizard and builds the resulting configuration.
 * @param {{mode: string, source: object, name: string|null, sourceName: string|null}} context - Wizard mode and starting point.
 * @returns {Promise<{name: string, configuration: object, identities: Map, selfName: string|null}>} The configuration built, with what the summary needs.
 * @throws {WizardCancelled} On ESC.
 */
async function collectAnswers({ mode, source, name, sourceName }) {
  const existingNames = await configLoader.listConfigurations();
  const identities = await configLoader.listIdentities();
  const originalAuth = source.auth && typeof source.auth === "object" ? source.auth : {};
  const selfName = mode === "edit" ? name : null;
  //
  ui.showSectionHeader(mode === "edit" ? `Edit configuration "${name}"` : "New configuration");
  ui.writeInline(ui.formatGray("ENTER keeps the value shown, \"-\" clears it, ESC discards everything.\n"));
  let configName = name;
  if (mode !== "edit") {
    const copyName = sourceName ? `${sourceName}-copy` : "";
    const canSuggest = paths.isValidName(copyName) && !editor.isNameTaken(existingNames, copyName);
    configName = await askText({
      message: "Configuration name:",
      default: canSuggest ? copyName : "",
      validate: editor.validateConfigName(existingNames)
    });
  }
  const defaultProjectId = await askText({
    message: "Project ID:",
    default: editor.asText(source.defaultProjectId),
    validate: editor.validateProjectId
  });
  //
  ui.showSectionHeader("Authentication");
  const identity = await askIdentity(identities, editor.asText(originalAuth.identity), configName);
  const defaults = authDefaults({ identities, identity, originalAuth, selfName });
  const account = await askText({
    message: "Google account to log in with (optional):",
    default: defaults.account,
    validate: editor.validateAccount
  });
  const impersonateServiceAccount = await askText({
    message: "Service account to impersonate (optional):",
    default: defaults.impersonateServiceAccount,
    validate: editor.validateServiceAccount
  });
  const quotaProject = await askQuotaProject({ originalAuth, impersonateServiceAccount, defaultProjectId });
  //
  ui.showSectionHeader("Storage");
  const buckets = await askText({
    message: "Buckets (comma or space separated):",
    default: editor.effectiveBuckets(source).join(", "),
    validate: editor.validateBucketList
  });
  //
  ui.showSectionHeader("Firewall");
  const defaultFirewallRule = await askText({
    message: "Firewall rule to update with your IP (optional):",
    default: editor.asText(source.defaultFirewallRule),
    validate: editor.validateFirewallRule
  });
  const fixedIPAddresses = await askText({
    message: "Fixed IPs always kept in the rule (comma or space separated):",
    default: editor.fixedRanges(source).join(", "),
    validate: editor.validateCidrList
  });
  //
  ui.showSectionHeader("SSH");
  const tunnelThroughIap = orCancel(await askYesNo("Connect to VMs through IAP (needed for VMs without an external IP)?", editor.tunnelsThroughIap(source)));
  let removeCredentialsFile;
  if (source.credentialsFile) {
    ui.showSectionHeader("Legacy key");
    ui.writeInline(ui.formatGray("After removing it, delete the key from the GCP console too: removing the local file alone does not invalidate it.\n"));
    removeCredentialsFile = orCancel(await askYesNo(`Remove the deprecated credentialsFile "${source.credentialsFile}"?`, true));
  }
  //
  const configuration = editor.buildConfiguration(source, {
    defaultProjectId,
    identity,
    account,
    impersonateServiceAccount,
    quotaProject,
    buckets: editor.parseList(buckets),
    defaultFirewallRule,
    fixedIPAddresses: editor.parseList(fixedIPAddresses).map(editor.normalizeCidr),
    tunnelThroughIap,
    removeCredentialsFile
  });
  return { name: configName, configuration, identities, selfName };
}
//
/**
 * Runs the wizard, shows the summary and asks whether to save.
 * @param {{mode: string, source: object, name?: string, sourceName?: string}} context - "create", "edit" or "duplicate", and the starting configuration.
 * @returns {Promise<{name: string, configuration: object, hasConflicts: boolean}|null>} The configuration to save, or null if discarded.
 */
async function runWizard({ mode, source, name = null, sourceName = null }) {
  let result;
  try {
    result = await collectAnswers({ mode, source, name, sourceName });
  } catch (err) {
    if (err instanceof WizardCancelled) {
      ui.showInfo("Discarded, nothing saved.");
      return null;
    }
    throw err;
  }
  //
  const { configuration, identities, selfName } = result;
  const auth = configuration.auth;
  const conflicts = editor.findIdentityConflicts(identities, auth.identity, {
    account: auth.account,
    impersonateServiceAccount: auth.impersonateServiceAccount
  }, selfName);
  const isEdit = mode === "edit";
  const rows = editor.describeFields(configuration, isEdit ? source : undefined);
  ui.showSectionHeader("Summary");
  if (isEdit && rows.every(row => !row.changed)) {
    ui.showInfo("No changes, nothing to save.");
    return null;
  }
  showSummary(rows, isEdit);
  if (conflicts.length > 0) {
    ui.blankLine();
    showIdentityConflicts(auth.identity, conflicts);
  }
  ui.blankLine();
  const save = await askChoice({
    message: "Save this configuration? (ESC to discard):",
    choices: [
      { name: "1. Save", value: true },
      { name: "2. Discard", value: false }
    ]
  });
  if (!save) {
    ui.showInfo("Discarded, nothing saved.");
    return null;
  }
  return { name: result.name, configuration, hasConflicts: conflicts.length > 0 };
}
//
/**
 * Saves a configuration, then offers to log in when its credentials do not fit it.
 * With an identity conflict the offer defaults to No, since that login would switch
 * the other configurations using the identity.
 * @param {{name: string, configuration: object, hasConflicts: boolean}} result - Result of runWizard().
 * @returns {Promise<void>}
 */
async function saveAndOfferLogin({ name, configuration, hasConflicts }) {
  const filePath = await configLoader.saveConfiguration(name, configuration);
  ui.showSuccess(`Saved: ${filePath}`);
  const reason = gcpAuth.describeLoginNeed(configuration);
  if (!reason) {
    return;
  }
  ui.showWarning(reason);
  const loginNow = await askYesNo("Log in now?", !hasConflicts);
  if (!loginNow) {
    return;
  }
  ui.blankLine();
  try {
    await authCommand.login(configuration.auth);
  } catch (err) {
    authCommand.showAuthFailure(err, configuration.auth);
  }
}
//
/**
 * Creates a new configuration through the wizard.
 * @returns {Promise<boolean>} True if a configuration was saved.
 */
async function createConfiguration() {
  const result = await runWizard({ mode: "create", source: {} });
  if (!result) {
    return false;
  }
  await saveAndOfferLogin(result);
  return true;
}
//
/**
 * Edits an existing configuration through the wizard.
 * @param {{name: string, configuration: object|null}} entry - Entry from configLoader.readConfigurations().
 * @returns {Promise<void>}
 */
async function editConfiguration(entry) {
  if (!entry.configuration) {
    ui.showError(`Configuration "${entry.name}" is not readable JSON: fix it by hand, or delete it.`);
    return;
  }
  const result = await runWizard({ mode: "edit", source: entry.configuration, name: entry.name });
  if (result) {
    await saveAndOfferLogin(result);
  }
}
//
/**
 * Creates a configuration starting from the values of an existing one.
 * The janitor exceptions of the source are not copied.
 * @param {Array<{name: string, configuration: object|null}>} entries - Entries from configLoader.readConfigurations().
 * @returns {Promise<void>}
 */
async function duplicateConfiguration(entries) {
  const selected = await askChoice({
    message: "Duplicate which configuration? (ESC or ← to go back):",
    choices: entries.map((entry, i) => ({ name: `${i + 1}. ${entry.name}`, value: entry.name })),
    enableBack: true
  });
  if (typeof selected !== "string") {
    return;
  }
  const entry = entries.find(e => e.name === selected);
  if (!entry.configuration) {
    ui.showError(`Configuration "${entry.name}" is not readable JSON, so it cannot be duplicated.`);
    return;
  }
  const result = await runWizard({ mode: "duplicate", source: entry.configuration, sourceName: entry.name });
  if (result) {
    await saveAndOfferLogin(result);
  }
}
//
/**
 * Offers to revoke the credentials of an identity that no configuration uses anymore.
 * @param {object} auth - The auth block of the deleted configuration.
 * @returns {Promise<void>}
 */
async function offerOrphanRevoke(auth) {
  if (!auth || !paths.isValidName(auth.identity)) {
    return;
  }
  // Compared ignoring case: "Prod" and "prod" share one directory on macOS and Windows.
  const identities = await configLoader.listIdentities();
  const wanted = auth.identity.toLowerCase();
  const stillUsed = [...identities].some(([name, entry]) => entry.hasConfiguration && name.toLowerCase() === wanted);
  if (stillUsed) {
    return;
  }
  const info = gcpAuth.readAdcInfo(auth.identity);
  if (!info.exists || info.corrupt) {
    return;
  }
  ui.showInfo(`No configuration uses identity "${auth.identity}" anymore.`);
  try {
    await authCommand.revoke(auth);
  } catch (err) {
    ui.showError(`Could not revoke the credentials: ${err.message}`);
  }
}
//
/**
 * Deletes a configuration and its janitor exceptions, after confirmation.
 * @param {{name: string, configuration: object|null}} entry - Entry from configLoader.readConfigurations().
 * @returns {Promise<void>}
 */
async function deleteConfiguration(entry) {
  const confirmed = await askYesNo(`Delete configuration "${entry.name}" and its janitor exceptions?`, false);
  if (!confirmed) {
    return;
  }
  try {
    await configLoader.deleteConfiguration(entry.name);
  } catch (err) {
    ui.showError(`Could not delete "${entry.name}": ${err.message}`);
    return;
  }
  ui.showSuccess(`Deleted configuration "${entry.name}".`);
  await offerOrphanRevoke(entry.configuration && entry.configuration.auth);
}
//
/**
 * Shows the configurations with their identity and project.
 * @param {Array<{name: string, configuration: object|null}>} entries - Entries from configLoader.readConfigurations().
 * @returns {Promise<object|null>} Selected action, or null on ESC.
 */
async function showConfigurationMenu(entries) {
  const widths = [
    String(entries.length).length + 1,
    Math.max(0, ...entries.map(e => e.name.length)),
    Math.max(0, ...entries.map(e => editor.asText(((e.configuration || {}).auth || {}).identity).length))
  ];
  const choices = entries.map((entry, i) => {
    const cells = [`${i + 1}.`, entry.name];
    if (entry.configuration) {
      cells.push(editor.asText((entry.configuration.auth || {}).identity), ui.formatGray(editor.asText(entry.configuration.defaultProjectId)));
    } else {
      cells.push(ui.formatGray("(unreadable)"));
    }
    return { name: ui.formatColumns(cells, widths), value: { action: "edit", name: entry.name }, short: entry.name };
  });
  choices.push({ name: ui.formatNewChoice("New configuration"), value: { action: "new" } });
  if (entries.some(entry => entry.configuration)) {
    choices.push({ name: ui.formatNewChoice("Duplicate a configuration"), value: { action: "duplicate" } });
  }
  //
  return askChoice({
    message: "Configurations (ENTER to edit, DEL to delete, ESC to go back):",
    choices,
    deleteFilter: value => value.action === "edit"
  });
}
//
/**
 * Executes the configuration management command.
 * @returns {Promise<void>}
 */
async function execute() {
  while (true) {
    const entries = await configLoader.readConfigurations();
    const selected = await showConfigurationMenu(entries);
    if (selected === null) {
      return;
    }
    ui.blankLine();
    if (selected.action === "delete") {
      await deleteConfiguration(entries.find(e => e.name === selected.value.name));
    } else if (selected.action === "new") {
      await createConfiguration();
    } else if (selected.action === "duplicate") {
      await duplicateConfiguration(entries);
    } else {
      await editConfiguration(entries.find(e => e.name === selected.name));
    }
    ui.blankLine();
  }
}
//
module.exports = {
  name: "configure",
  description: "Manage configurations (create, edit, delete)",
  standalone: true,
  execute,
  createConfiguration
};
