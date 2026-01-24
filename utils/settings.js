const fs = require("fs");
const path = require("path");
const { getGlobalConfigDir } = require("./paths.js");
//
const SETTINGS_FILE = "settings.json";
//
/**
 * Default settings.
 */
const defaultSettings = {
  storage: {
    maxItems: 30
  }
};
//
/**
 * Loads and returns the application settings.
 * Looks for settings.json in local directory first, then global.
 * @returns {object} Settings object with defaults merged.
 */
function getSettings() {
  let userSettings = {};
  //
  // Try local settings first.
  const localPath = path.join(process.cwd(), SETTINGS_FILE);
  if (fs.existsSync(localPath)) {
    try {
      userSettings = JSON.parse(fs.readFileSync(localPath, "utf8"));
    } catch {
      // Ignore parse errors.
    }
  } else {
    // Try global settings.
    const globalPath = path.join(getGlobalConfigDir(), SETTINGS_FILE);
    if (fs.existsSync(globalPath)) {
      try {
        userSettings = JSON.parse(fs.readFileSync(globalPath, "utf8"));
      } catch {
        // Ignore parse errors.
      }
    }
  }
  //
  // Merge with defaults.
  return {
    storage: {
      ...defaultSettings.storage,
      ...userSettings.storage
    }
  };
}
//
module.exports = { getSettings };
