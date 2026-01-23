const fs = require("fs/promises");
const path = require("path");
//
const CONFIG_DIR = "Configurations";
const CONFIG_PREFIX = "gcp-options-";
const CONFIG_SUFFIX = ".json";
//
/**
 * Reads configuration names dynamically from the Configurations folder.
 * @returns {Promise<string[]>} Array of configuration names.
 */
async function listConfigurations() {
  const files = await fs.readdir(CONFIG_DIR);
  return files
    .filter(f => f.startsWith(CONFIG_PREFIX) && f.endsWith(CONFIG_SUFFIX))
    .map(f => f.slice(CONFIG_PREFIX.length, -CONFIG_SUFFIX.length))
    .sort();
}
//
module.exports = { listConfigurations };
