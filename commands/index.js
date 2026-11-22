const updateFirewall = require("./updateFirewall.js");
const storageNavigator = require("./storageNavigator.js");
const gcpJanitor = require("./gcpJanitor.js");
const vmConnect = require("./vmConnect.js");
const vmFiles = require("./vmFiles.js");
const auth = require("./auth.js");
const configure = require("./configure.js");
const init = require("./init.js");
//
/**
 * Registry of available commands.
 */
const commands = [
  vmConnect,
  vmFiles,
  storageNavigator,
  gcpJanitor,
  updateFirewall,
  auth,
  configure,
  init
];
//
module.exports = commands;
