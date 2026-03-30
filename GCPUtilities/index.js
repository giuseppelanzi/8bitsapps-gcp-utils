const Network = require("./Network.js");
const GCPUStorage = require("./Storage.js");
const Compute = require("./Compute.js");
const packageJson = require("../package.json");
//
const GCPUtils = {
  Network: Network,
  Storage: GCPUStorage,
  Compute: Compute,
  version: packageJson.version
};

module.exports = GCPUtils;
