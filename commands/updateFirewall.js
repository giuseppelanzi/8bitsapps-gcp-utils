const GCPUtils = require("../GCPUtilities");
const ui = require("../utils/ui.js");
//
/**
 * Executes the firewall update command.
 * @param {string} configName - Configuration name.
 */
async function execute(configName) {
  const networkManager = new GCPUtils.Network(configName);
  const result = await networkManager.updateFirewall();
  ui.showSuccess(`Firewall "${result.firewallRule}" updated with IP ${result.ip}. Operation: ${result.operationName}.`);
}
//
module.exports = {
  name: "updateFirewall",
  description: "Update Firewall with current IP",
  execute
};
