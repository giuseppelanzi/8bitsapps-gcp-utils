const fs = require("fs/promises");
const { getConfigurationsDir, getConfigPath } = require("./paths.js");
//
const CONFIG_PREFIX = "gcp-options-";
const CONFIG_SUFFIX = ".json";
//
/**
 * Reads configuration names dynamically from the user config directory.
 * @returns {Promise<string[]>} Array of configuration names.
 */
async function listConfigurations() {
  const configDir = getConfigurationsDir();
  try {
    const files = await fs.readdir(configDir);
    return files
      .filter(f => f.startsWith(CONFIG_PREFIX) && f.endsWith(CONFIG_SUFFIX))
      .map(f => f.slice(CONFIG_PREFIX.length, -CONFIG_SUFFIX.length))
      .sort();
  } catch {
    return [];
  }
}
//
/**
 * Loads a configuration file.
 * @param {string} configName - Configuration name.
 * @returns {Promise<object>} Parsed configuration.
 */
async function loadConfiguration(configName) {
  return JSON.parse(await fs.readFile(getConfigPath(configName), "utf8"));
}
//
module.exports = { listConfigurations, loadConfiguration };
