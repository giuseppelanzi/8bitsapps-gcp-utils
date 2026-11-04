const fs = require("fs/promises");
const paths = require("./paths.js");
const exceptions = require("./exceptions.js");
//
const CONFIG_PREFIX = "gcp-options-";
const CONFIG_SUFFIX = ".json";
//
/**
 * Reads configuration names dynamically from the user config directory.
 * @returns {Promise<string[]>} Array of configuration names.
 */
async function listConfigurations() {
  const configDir = paths.getConfigurationsDir();
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
  return JSON.parse(await fs.readFile(paths.getConfigPath(configName), "utf8"));
}
//
/**
 * Validates a configuration name used as part of a file name.
 * A new name must use safe characters only. A name already in the directory is
 * accepted as it is, since it comes from a file name and cannot hold a path
 * separator: a hand-made "gcp-options-My Project.json" stays editable and deletable.
 * @param {string} configName - Configuration name.
 * @returns {Promise<void>}
 * @throws {Error} If the name is new and would produce an unsafe file name.
 */
async function assertUsableConfigName(configName) {
  if (paths.isValidName(configName) || (await listConfigurations()).includes(configName)) {
    return;
  }
  throw new Error(`Invalid configuration name "${configName}". Use letters, digits, dot, dash or underscore.`);
}
//
/**
 * Tells whether a file exists.
 * @param {string} filePath - Absolute path.
 * @returns {Promise<boolean>} True if the file exists.
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
//
/**
 * Tells whether a configuration file exists.
 * @param {string} configName - Configuration name.
 * @returns {Promise<boolean>} True if the configuration exists.
 */
async function configurationExists(configName) {
  return fileExists(paths.getConfigPath(configName));
}
//
/**
 * Loads every configuration, keeping the unreadable ones in the list.
 * @returns {Promise<Array<{name: string, configuration: object|null}>>} Configurations, null when unreadable or not a JSON object.
 */
async function readConfigurations() {
  const result = [];
  for (const name of await listConfigurations()) {
    let configuration = null;
    try {
      const parsed = await loadConfiguration(name);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        configuration = parsed;
      }
    } catch {
      // Unreadable or not JSON: listed anyway, so that it can be deleted.
    }
    result.push({ name, configuration });
  }
  return result;
}
//
/**
 * Writes a configuration file.
 * The content goes to a temporary file first and is then renamed, so an
 * interrupted write never leaves a truncated configuration behind.
 * @param {string} configName - Configuration name.
 * @param {object} configuration - Configuration to write.
 * @returns {Promise<string>} Absolute path of the written file.
 */
async function saveConfiguration(configName, configuration) {
  await assertUsableConfigName(configName);
  const filePath = paths.getConfigPath(configName);
  const tempPath = `${filePath}.tmp`;
  await fs.mkdir(paths.getConfigurationsDir(), { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(configuration, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
  return filePath;
}
//
/**
 * Deletes a configuration file and the janitor exceptions that belong to it.
 * @param {string} configName - Configuration name.
 * @returns {Promise<void>}
 */
async function deleteConfiguration(configName) {
  await assertUsableConfigName(configName);
  await fs.unlink(paths.getConfigPath(configName));
  try {
    await fs.unlink(exceptions.getExceptionsPath(configName));
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw err;
    }
  }
}
//
/**
 * Lists the known identities: those named by a configuration, plus the identity
 * directories that hold credentials but are no longer used by any configuration.
 * Identities with an invalid name are skipped, since no path can be built for them.
 * @returns {Promise<Map<string, {configs: Array<{name: string, account: string, impersonateServiceAccount: string}>, hasConfiguration: boolean}>>} Identities sorted by name.
 */
async function listIdentities() {
  const identities = new Map();
  for (const { name, configuration } of await readConfigurations()) {
    const auth = (configuration && configuration.auth) || {};
    if (!paths.isValidName(auth.identity)) {
      continue;
    }
    if (!identities.has(auth.identity)) {
      identities.set(auth.identity, { configs: [], hasConfiguration: true });
    }
    identities.get(auth.identity).configs.push({
      name,
      account: typeof auth.account === "string" ? auth.account : "",
      impersonateServiceAccount: typeof auth.impersonateServiceAccount === "string" ? auth.impersonateServiceAccount : ""
    });
  }
  //
  let entries = [];
  try {
    entries = await fs.readdir(paths.getGcloudRootDir(), { withFileTypes: true });
  } catch {
    // No identity has logged in yet.
  }
  // Compared ignoring case: on macOS and Windows "Prod" and "prod" share one directory.
  const known = new Set([...identities.keys()].map(name => name.toLowerCase()));
  for (const entry of entries) {
    if (!entry.isDirectory() || !paths.isValidName(entry.name) || known.has(entry.name.toLowerCase())) {
      continue;
    }
    if (await fileExists(paths.getAdcPath(entry.name))) {
      identities.set(entry.name, { configs: [], hasConfiguration: false });
    }
  }
  //
  return new Map([...identities.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
//
module.exports = {
  listConfigurations,
  loadConfiguration,
  configurationExists,
  readConfigurations,
  saveConfiguration,
  deleteConfiguration,
  listIdentities
};
