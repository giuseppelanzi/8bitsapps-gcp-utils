const fs = require("fs/promises");
const inquirer = require("inquirer");
const paths = require("../utils/paths.js");
const configLoader = require("../utils/configLoader.js");
const configure = require("./configure.js");
const ui = require("../utils/ui.js");
//
const EXAMPLE_NAME = "example";
//
/**
 * Example configuration, written when the user prefers to edit the files by hand.
 */
const exampleConfig = {
  auth: {
    identity: "example",
    account: "you@example.com",
    quotaProject: "YOUR_PROJECT_ID"
  },
  defaultProjectId: "YOUR_PROJECT_ID",
  defaultFirewallRule: "YOUR_FIREWALL_RULE_NAME",
  defaultFixedIPAddresses: ["8.8.8.8/32"],
  defaultBucket: "YOUR_BUCKET_NAME",
  ssh: {
    tunnelThroughIap: false
  }
};
//
/**
 * Writes the example configuration, unless it already exists.
 * @returns {Promise<void>}
 */
async function writeExampleConfiguration() {
  if (await configLoader.configurationExists(EXAMPLE_NAME)) {
    ui.showWarning("Example config already exists.");
    return;
  }
  const exampleConfigPath = await configLoader.saveConfiguration(EXAMPLE_NAME, exampleConfig);
  ui.showSuccess(`Created: ${exampleConfigPath}`);
}
//
/**
 * Shows what to do next when no real configuration exists yet.
 * @param {string} configurationsDir - Directory of the configuration files.
 */
function showNextSteps(configurationsDir) {
  ui.blankLine();
  ui.showInfo("Next steps:");
  ui.writeInline(`1. Run gcpUtils to create a configuration with the wizard ("Manage configurations"), or edit the files in ${configurationsDir}/ by hand.\n`);
  ui.writeInline("2. Log in when the wizard offers it, or later with \"Manage authentication\".\n");
  ui.writeInline("3. Run gcpUtils and use any command.\n");
}
//
/**
 * Init command - creates the configuration directories and the first configuration.
 * The directories are those the tool reads from, so local mode is respected.
 */
const command = {
  name: "init",
  description: "Initialize configuration directory",
  /**
   * Executes the init command.
   * @returns {Promise<boolean>} True if a configuration was created through the wizard.
   */
  async execute() {
    const configurationsDir = paths.getConfigurationsDir();
    ui.showInfo("Initializing gcp-utils configuration...");
    ui.writeInline(`Config directory: ${configurationsDir}\n`);
    //
    // Create directories if they don't exist.
    await fs.mkdir(configurationsDir, { recursive: true });
    await fs.mkdir(paths.getCredentialsDir(), { recursive: true });
    await fs.mkdir(paths.getGcloudRootDir(), { recursive: true });
    //
    // Offer the wizard only when there is nothing to work with yet.
    if ((await configLoader.listConfigurations()).length === 0) {
      const { createNow } = await inquirer.prompt([{
        type: "confirm",
        name: "createNow",
        message: "Create your first configuration now?",
        default: true
      }]);
      if (createNow) {
        if (await configure.createConfiguration()) {
          return true;
        }
      } else {
        await writeExampleConfiguration();
      }
    }
    //
    ui.blankLine();
    ui.showInfo("Setup complete!");
    const realConfigurations = (await configLoader.listConfigurations()).filter(name => name !== EXAMPLE_NAME);
    if (realConfigurations.length === 0) {
      showNextSteps(configurationsDir);
    }
    return false;
  }
};
//
module.exports = command;
