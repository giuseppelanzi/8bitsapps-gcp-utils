const GCPUtils = require("../GCPUtils");
//
/**
 * Executes the firewall update command.
 * @param {string} configName - Configuration name.
 */
async function execute(configName) {
  const networkManager = new GCPUtils.Network(configName);
  await networkManager.updateFirewall();
}
//
module.exports = {
  name: "updateFirewall",
  description: "Update Firewall with current IP",
  execute
};
