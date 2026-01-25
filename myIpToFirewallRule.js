const inquirer = require("inquirer");
const GCPUtils = require("./GCPUtilities");
const { listConfigurations } = require("./utils/configLoader.js");
const { getConfigurationsDir } = require("./utils/paths.js");
//
/**
 * Shows configuration selection menu.
 * @returns {Promise<string>} Selected configuration name.
 */
async function selectConfiguration() {
  const configs = await listConfigurations();
  //
  if (configs.length === 0) {
    throw new Error(`No configuration found in ${getConfigurationsDir()}/. Run 'gcpUtils' to initialize.`);
  }
  //
  const choices = configs.map((cfg, i) => ({
    name: `${i + 1}. ${cfg}`,
    value: cfg
  }));
  //
  const { selected } = await inquirer.prompt([{
    type: "list",
    name: "selected",
    message: "Select configuration:",
    choices
  }]);
  //
  return selected;
}
//
(async () => {
  let configName = process.argv[2];
  //
  // If no argument provided, show interactive menu.
  if (!configName) {
    console.log("=== Update Firewall ===\n");
    configName = await selectConfiguration();
    console.log();
  }
  //
  const networkManager = new GCPUtils.Network(configName);
  await networkManager.updateFirewall();
})();
