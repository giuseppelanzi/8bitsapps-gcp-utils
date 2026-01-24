const updateFirewall = require("./updateFirewall.js");
const storageNavigator = require("./storageNavigator.js");
const init = require("./init.js");
//
/**
 * Registry of available commands.
 */
const commands = [
  updateFirewall,
  storageNavigator,
  init
];
//
module.exports = commands;
