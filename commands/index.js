const updateFirewall = require("./updateFirewall.js");
const storageNavigator = require("./storageNavigator.js");
const gcpJanitor = require("./gcpJanitor.js");
const vmSsh = require("./vmSsh.js");
const auth = require("./auth.js");
const init = require("./init.js");
//
/**
 * Registry of available commands.
 */
const commands = [
  vmSsh,
  storageNavigator,
  gcpJanitor,
  updateFirewall,
  auth,
  init
];
//
module.exports = commands;
