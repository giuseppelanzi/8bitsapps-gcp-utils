const Network = require("./Network.js");
const GCPUStorage = require("./Storage.js");
const packageJson = require("../package.json");
//
const GCPUtils = {
  Network: Network,
  Storage: GCPUStorage,
  version: packageJson.version
};

module.exports = GCPUtils;
