const axios = require("axios");
const compute = require("@google-cloud/compute");
const fs = require("fs/promises");
const { getConfigPath, getCredentialsPath } = require("../utils/paths.js");

class Network {
  constructor(configName) {
    this.configurationName = configName;
    this.configuration = null;
    this.credentials = null;
    this.computeClient = null;
  }

  async loadConfiguration() {
    if (this.configuration) {
      return; // Already loaded.
    }
    if (!this.configurationName)
      throw new Error("Missing configuration name.");
    //
    const configFileName = getConfigPath(this.configurationName);
    this.configuration = JSON.parse(await fs.readFile(configFileName, "utf8"));
    //
    const credentialsFileName = getCredentialsPath(this.configuration.credentialsFile);
    this.credentials = JSON.parse(await fs.readFile(credentialsFileName, "utf8"));
    //
    this.computeClient = new compute.FirewallsClient({
      credentials: this.credentials,
      projectId: this.configuration.defaultProjectId
    });
  }

  unloadConfiguration() {
    this.configuration = null;
    this.credentials = null;
    this.computeClient = null;
  }

  async getPublicIP() {
    const res = await axios.get("https://api.ipify.org?format=json");
    return res.data.ip;
  }

  async updateFirewall(options) {
    await this.loadConfiguration();
    //
    const projectId = options?.projectId ?? this.configuration?.defaultProjectId;
    const firewallRule = options?.firewallRule ?? this.configuration?.defaultFirewallRule;
    const fixedIPAddresses = options?.fixedIPAddresses ?? this.configuration?.defaultFixedIPAddresses;
    //
    if (!projectId || !firewallRule) {
      throw new Error("Both projectId and firewallRule must be specified either in options or in the configuration file.");
    }
    //
    const ip = await this.getPublicIP();
    const ipCidr = `${ip}/32`;
    //
    const [rule] = await this.computeClient.get({
      project: projectId,
      firewall: firewallRule,
    });
    //
    const updatedRule = {
      ...rule,
      sourceRanges: [...(fixedIPAddresses || []), ipCidr],
    };
    //
    const [operation] = await this.computeClient.patch({
      project: projectId,
      firewall: firewallRule,
      firewallResource: updatedRule,
    });
    //
    return {
      operationName: operation.name,
      ip: ipCidr,
      firewallRule,
      projectId
    };
  }
}

module.exports = Network;
