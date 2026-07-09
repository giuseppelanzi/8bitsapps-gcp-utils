const updateFirewall = require("./updateFirewall.js");
const storageNavigator = require("./storageNavigator.js");
const gcpJanitor = require("./gcpJanitor.js");
const auth = require("./auth.js");
const init = require("./init.js");
//
/**
 * Registry of available commands.
 */
const commands = [
  updateFirewall,
  storageNavigator,
  gcpJanitor,
  auth,
  init
];
//
module.exports = commands;
