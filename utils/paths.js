const os = require("os");
const path = require("path");
const fs = require("fs");
//
const APP_NAME = "gcp-utils";
const LOCAL_CONFIG_DIR = "Configurations";
const LOCAL_CREDS_DIR = "Credentials";
//
/**
 * Determines if local mode should be used.
 * @returns {boolean} True if local Configurations/ folder exists.
 */
function isLocalMode() {
  const localConfigPath = path.join(process.cwd(), LOCAL_CONFIG_DIR);
  return fs.existsSync(localConfigPath);
}
//
/**
 * Returns the global configuration directory path.
 * @returns {string} Absolute path to global config directory.
 */
function getGlobalConfigDir() {
  const homeDir = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), APP_NAME);
  }
  return path.join(homeDir, `.${APP_NAME}`);
}
//
/**
 * Returns the configurations directory path.
 * @returns {string} Absolute path to configurations directory.
 */
function getConfigurationsDir() {
  if (isLocalMode()) {
    return path.join(process.cwd(), LOCAL_CONFIG_DIR);
  }
  return path.join(getGlobalConfigDir(), "configurations");
}
//
/**
 * Returns the credentials directory path.
 * @returns {string} Absolute path to credentials directory.
 */
function getCredentialsDir() {
  if (isLocalMode()) {
    return path.join(process.cwd(), LOCAL_CREDS_DIR);
  }
  return path.join(getGlobalConfigDir(), "credentials");
}
//
/**
 * Returns the full path to a configuration file.
 * @param {string} configName - Configuration name.
 * @returns {string} Absolute path to configuration file.
 */
function getConfigPath(configName) {
  return path.join(getConfigurationsDir(), `gcp-options-${configName}.json`);
}
//
/**
 * Returns the full path to a credentials file.
 * @param {string} credentialsFile - Credentials file name.
 * @returns {string} Absolute path to credentials file.
 */
function getCredentialsPath(credentialsFile) {
  return path.join(getCredentialsDir(), credentialsFile);
}
//
module.exports = {
  isLocalMode,
  getGlobalConfigDir,
  getConfigurationsDir,
  getCredentialsDir,
  getConfigPath,
  getCredentialsPath
};
