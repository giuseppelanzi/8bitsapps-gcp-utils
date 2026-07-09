const fs = require("fs/promises");
const inquirer = require("inquirer");
const { getConfigPath, getAdcPath } = require("../utils/paths.js");
const gcloud = require("../utils/gcloud.js");
const { readAdcInfo, describeCredentialType, describeAuthError, describeIdentityMismatch } = require("../utils/gcpAuth.js");
const ui = require("../utils/ui.js");
//
/**
 * Loads a configuration file.
 * @param {string} configName - Configuration name.
 * @returns {Promise<object>} Parsed configuration.
 */
async function loadConfiguration(configName) {
  return JSON.parse(await fs.readFile(getConfigPath(configName), "utf8"));
}
//
/**
 * Logs in and stores the credentials of an identity.
 * The notices of gcloud about the machine-wide ADC are filtered out by loginAdc(),
 * because these credentials only ever reach the clients through buildClientOptions().
 * @param {object} auth - The auth block of the configuration.
 * @returns {Promise<void>}
 */
async function login(auth) {
  ui.showInfo(`Opening the browser to authenticate identity "${auth.identity}"...`);
  await gcloud.loginAdc(auth);
  ui.showSuccess(`Credentials stored for "${auth.identity}".`);
  ui.writeInline(ui.formatGray(`Path: ${getAdcPath(auth.identity)}\n`));
  ui.writeInline(ui.formatGray("Scoped to this tool only, not the system-wide ADC.\n"));
}
//
/**
 * Describes the project that will actually be billed for API usage.
 * The configuration wins over the value stored in the credentials file.
 * @param {object} auth - The auth block of the configuration.
 * @param {object} info - Summary returned by readAdcInfo().
 * @returns {string} The effective quota project.
 */
function describeEffectiveQuotaProject(auth, info) {
  if (auth.impersonateServiceAccount) {
    return "not needed (the service account is billed)";
  }
  if (auth.quotaProject) {
    return `${auth.quotaProject} (from the configuration)`;
  }
  return info.quotaProject || "not set";
}
//
/**
 * Shows which identity the stored credentials belong to.
 * @param {object} configuration - Loaded configuration object.
 * @returns {Promise<void>}
 */
async function status(configuration) {
  const auth = configuration.auth;
  const info = readAdcInfo(auth.identity);
  if (!info.exists) {
    ui.showWarning(`Identity "${auth.identity}" is not authenticated.`);
    ui.writeInline(ui.formatGray(`Expected credentials at ${info.path}\n`));
    return;
  }
  if (info.corrupt) {
    ui.showError(`The credentials file of "${auth.identity}" is not readable JSON.`);
    ui.showWarning("Run Login to recreate it.");
    return;
  }
  //
  ui.showInfo(`Credentials: ${describeCredentialType(info.type)}`);
  if (info.impersonatedServiceAccount) {
    ui.showInfo(`Impersonating: ${info.impersonatedServiceAccount}`);
  }
  ui.showInfo(`Quota project: ${describeEffectiveQuotaProject(auth, info)}`);
  ui.writeInline(ui.formatGray(`Path: ${info.path}\n`));
  //
  const mismatch = describeIdentityMismatch(configuration);
  if (mismatch) {
    ui.showWarning(mismatch);
  }
  //
  try {
    const account = await gcloud.resolveActiveAccount(auth.identity);
    ui.showSuccess(`Active as: ${account}`);
  } catch (err) {
    ui.showError(`Could not verify the credentials: ${err.message}`);
    const hint = describeAuthError(err);
    if (hint) {
      ui.showWarning(hint);
    }
  }
}
//
/**
 * Revokes the stored credentials of an identity.
 * @param {object} auth - The auth block of the configuration.
 * @returns {Promise<void>}
 */
async function revoke(auth) {
  const { confirmed } = await inquirer.prompt([{
    type: "confirm",
    name: "confirmed",
    message: `Revoke the credentials of identity "${auth.identity}"?`,
    default: false
  }]);
  if (!confirmed) {
    return;
  }
  //
  await gcloud.revokeAdc(auth.identity);
  ui.showSuccess(`Credentials revoked for "${auth.identity}".`);
}
//
/**
 * Shows the authentication action menu.
 * @returns {Promise<string|null>} Selected action, or null on ESC.
 */
async function showActionMenu() {
  const { selected } = await inquirer.prompt([{
    type: "listWithEscape",
    name: "selected",
    message: "Authentication (ESC to go back):",
    choices: [
      { name: "1. Login", value: "login" },
      { name: "2. Status", value: "status" },
      { name: "3. Revoke", value: "revoke" }
    ],
    enableBack: false
  }]);
  return selected;
}
//
/**
 * Shows how to migrate a configuration that has no auth block.
 * @param {string} configName - Configuration name.
 */
function showMigrationHint(configName) {
  ui.showWarning(`Configuration "${configName}" has no "auth.identity".`);
  ui.showInfo("Add an auth block to the configuration to use short-lived credentials:");
  ui.writeInline(ui.formatGray("  \"auth\": { \"identity\": \"my-company\", \"account\": \"me@my-company.com\" }\n"));
}
//
/**
 * Executes the authentication command.
 * @param {string} configName - Configuration name.
 */
async function execute(configName) {
  const configuration = await loadConfiguration(configName);
  const auth = configuration.auth;
  //
  if (!auth || !auth.identity) {
    showMigrationHint(configName);
    return;
  }
  //
  while (true) {
    const action = await showActionMenu();
    if (action === null) {
      return;
    }
    ui.blankLine();
    try {
      if (action === "login") {
        await login(auth);
      } else if (action === "status") {
        await status(configuration);
      } else {
        await revoke(auth);
      }
    } catch (err) {
      ui.showError(err.message);
      const hint = describeAuthError(err);
      if (hint) {
        ui.showWarning(hint);
      }
      ui.writeInline(ui.formatGray(`Equivalent command: ${gcloud.formatLoginCommand(auth)}\n`));
    }
    ui.blankLine();
  }
}
//
module.exports = {
  name: "auth",
  description: "Manage authentication (login, status, revoke)",
  execute
};
