const fs = require("fs/promises");
const path = require("path");
const { getGlobalConfigDir } = require("../utils/paths.js");
const ui = require("../utils/ui.js");
//
/**
 * Init command - initializes the global configuration directory.
 */
const command = {
  name: "init",
  description: "Initialize global configuration directory",
  async execute() {
    const configDir = getGlobalConfigDir();
    const configurationsDir = path.join(configDir, "configurations");
    const credentialsDir = path.join(configDir, "credentials");
    //
    ui.showInfo("Initializing gcp-utils configuration...");
    console.log(`Config directory: ${configDir}`);
    //
    // Create directories if they don't exist.
    await fs.mkdir(configurationsDir, { recursive: true });
    await fs.mkdir(credentialsDir, { recursive: true });
    //
    // Create example configuration file.
    const exampleConfig = {
      credentialsFile: "gcp-credentials-example.json",
      defaultProjectId: "YOUR_PROJECT_ID",
      defaultFirewallRule: "YOUR_FIREWALL_RULE_NAME",
      defaultFixedIPAddresses: ["8.8.8.8/32"],
      defaultBucket: "YOUR_BUCKET_NAME"
    };
    const exampleConfigPath = path.join(configurationsDir, "gcp-options-example.json");
    //
    try {
      await fs.access(exampleConfigPath);
      ui.showWarning("Example config already exists.");
    } catch {
      await fs.writeFile(exampleConfigPath, JSON.stringify(exampleConfig, null, 2));
      ui.showSuccess(`Created: ${exampleConfigPath}`);
    }
    //
    ui.showInfo("\nSetup complete!");
    console.log("\nNext steps:");
    console.log(`1. Add your GCP credentials JSON to: ${credentialsDir}/`);
    console.log(`2. Edit configuration files in: ${configurationsDir}/`);
    console.log("3. Run: gcpUtils");
  }
};
//
module.exports = command;
