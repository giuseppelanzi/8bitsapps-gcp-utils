const os = require("os");
const path = require("path");
const fs = require("fs");
//
const APP_NAME = "8bitsapps-gcp-utils";
const LOCAL_CONFIG_DIR = "Configurations";
const LOCAL_CREDS_DIR = "Credentials";
const GCLOUD_DIR = "gcloud";
const ADC_FILE = "application_default_credentials.json";
const IDENTITY_PATTERN = /^[A-Za-z0-9._-]+$/;
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
 * Validates an auth identity name used as a directory name.
 * @param {string} identity - Identity name.
 * @throws {Error} If the identity is missing or would escape its parent directory.
 */
function assertValidIdentity(identity) {
  if (!identity || !IDENTITY_PATTERN.test(identity) || identity === "." || identity === "..") {
    throw new Error(`Invalid auth identity "${identity}". Use letters, digits, dot, dash or underscore.`);
  }
}
//
/**
 * Returns the gcloud configuration directory for an identity.
 * Used as CLOUDSDK_CONFIG so every identity keeps its own credentials.
 * @param {string} identity - Identity name.
 * @returns {string} Absolute path to the gcloud configuration directory.
 */
function getGcloudDir(identity) {
  assertValidIdentity(identity);
  if (isLocalMode()) {
    return path.join(process.cwd(), LOCAL_CREDS_DIR, GCLOUD_DIR, identity);
  }
  return path.join(getGlobalConfigDir(), GCLOUD_DIR, identity);
}
//
/**
 * Returns the path to the Application Default Credentials file of an identity.
 * @param {string} identity - Identity name.
 * @returns {string} Absolute path to the ADC file.
 */
function getAdcPath(identity) {
  return path.join(getGcloudDir(identity), ADC_FILE);
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
/**
 * Returns a timestamped export file path in the current working directory.
 * @param {string} prefix - File name prefix (e.g. "vm-instances").
 * @returns {string} Absolute path to the export CSV file.
 */
function getExportPath(prefix) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(process.cwd(), `${prefix}-${timestamp}.csv`);
}
//
module.exports = {
  isLocalMode,
  getGlobalConfigDir,
  getConfigurationsDir,
  getCredentialsDir,
  getGcloudDir,
  getAdcPath,
  getConfigPath,
  getCredentialsPath,
  getExportPath
};
