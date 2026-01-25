const { JWT } = require("google-auth-library");
const axios = require("axios");
const compute = require("@google-cloud/compute");
const fs = require("fs/promises");
const { getConfigPath, getCredentialsPath } = require("../utils/paths.js");

class Network {
  constructor(configName) {
    this.configurationName = configName;
    this.configuration = null;
    this.credentials = null;
    this.authClient = null;
    this.computeClient = null;
  }

  async loadConfiguration() {
    if (this.configuration) {
      return; // Already loaded
    }
    if (!this.configurationName)
      throw new Error(`Missing configuration name.`);
    //
    try {
      const configFileName = getConfigPath(this.configurationName);
      console.log(`Loading configuration: ${configFileName}.`);
      this.configuration = JSON.parse(await fs.readFile(configFileName, "utf8"));
      //
      const credentialsFileName = getCredentialsPath(this.configuration.credentialsFile);
      console.log(`Loading credentials: ${credentialsFileName}.`);
      this.credentials = JSON.parse(await fs.readFile(credentialsFileName, "utf8"));
      //
      this.authClient = new JWT({
        email: this.credentials?.client_email,
        key: this.credentials?.private_key,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      this.computeClient = new compute.FirewallsClient({ auth: this.authClient });
    } 
    catch (ex) {
      console.error(`Error while reading the config file: ${ex}.`);
      throw ex;
    }
  }

  unloadConfiguration() {
    this.configuration = null;
    this.credentials = null;
    this.authClient = null;
    this.computeClient = null;
  }

  async getPublicIP() {
    try {
      const res = await axios.get('https://api.ipify.org?format=json');
      return res.data.ip;
    } catch (error) {
      console.error("Error getting public IP:", error);
      throw error;
    }
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
    try {
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
      console.log("Firewall updated. Operation:", operation.name);
    } catch (err) {
      if (err.code === 404) {
        console.log("Rule not found!");
      } else {
        console.error("Error:", err);
      }
    }
  }
}

module.exports = Network;
