const axios = require("axios");
const packageJson = require("../package.json");
//
const NPM_REGISTRY_URL = "https://registry.npmjs.org";
const PACKAGE_NAME = packageJson.name;
const CURRENT_VERSION = packageJson.version;
//
/**
 * Compares two semver versions.
 * @param {string} current - Current version.
 * @param {string} latest - Latest version from registry.
 * @returns {boolean} True if latest is newer than current.
 */
function isNewerVersion(current, latest) {
  const currentParts = current.split(".").map(Number);
  const latestParts = latest.split(".").map(Number);
  //
  for (let i = 0; i < 3; i++) {
    if (latestParts[i] > currentParts[i]) return true;
    if (latestParts[i] < currentParts[i]) return false;
  }
  return false;
}
//
/**
 * Fetches the latest version from npm registry.
 * @returns {Promise<string|null>} Latest version or null on error.
 */
async function fetchLatestVersion() {
  try {
    const url = `${NPM_REGISTRY_URL}/${PACKAGE_NAME}/latest`;
    const response = await axios.get(url, { timeout: 3000 });
    return response.data.version || null;
  } catch {
    // Silently fail - network issues should not block the CLI.
    return null;
  }
}
//
/**
 * Checks for updates and returns update info.
 * @returns {Promise<{available: boolean, current: string, latest: string}|null>}
 */
async function checkForUpdates() {
  const latestVersion = await fetchLatestVersion();
  //
  if (!latestVersion) {
    return null;
  }
  //
  const updateAvailable = isNewerVersion(CURRENT_VERSION, latestVersion);
  //
  return {
    available: updateAvailable,
    current: CURRENT_VERSION,
    latest: latestVersion
  };
}
//
module.exports = {
  checkForUpdates,
  isNewerVersion,
  fetchLatestVersion,
  CURRENT_VERSION,
  PACKAGE_NAME
};
