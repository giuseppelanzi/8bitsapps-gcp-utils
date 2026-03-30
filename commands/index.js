const updateFirewall = require("./updateFirewall.js");
const storageNavigator = require("./storageNavigator.js");
const gcpJanitor = require("./gcpJanitor.js");
const init = require("./init.js");
//
/**
 * Registry of available commands.
 */
const commands = [
  updateFirewall,
  storageNavigator,
  gcpJanitor,
  init
];
//
module.exports = commands;
