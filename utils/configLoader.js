const fs = require("fs/promises");
const { getConfigurationsDir } = require("./paths.js");
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
module.exports = { listConfigurations };
