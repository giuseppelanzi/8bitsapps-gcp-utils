const fs = require("fs/promises");
const path = require("path");
const { getConfigurationsDir } = require("./paths.js");
//
/**
 * Returns the path to the exceptions file for a configuration.
 * @param {string} configName - Configuration name.
 * @returns {string} Absolute path to the exceptions file.
 */
function getExceptionsPath(configName) {
  return path.join(getConfigurationsDir(), `janitor-exceptions-${configName}.json`);
}
//
/**
 * Loads exceptions for a configuration.
 * Returns empty array if the file does not exist or is invalid.
 * @param {string} configName - Configuration name.
 * @returns {Promise<Array<{resourceType: string, resourceName: string, zone: string, markedAt: string, reason: string}>>}
 */
async function loadExceptions(configName) {
  const filePath = getExceptionsPath(configName);
  try {
    const data = JSON.parse(await fs.readFile(filePath, "utf8"));
    return data.exceptions || [];
  } catch {
    return [];
  }
}
//
/**
 * Saves exceptions for a configuration.
 * @param {string} configName - Configuration name.
 * @param {Array} exceptions - Array of exception objects.
 * @returns {Promise<void>}
 */
async function saveExceptions(configName, exceptions) {
  const filePath = getExceptionsPath(configName);
  const data = JSON.stringify({ exceptions }, null, 2);
  await fs.writeFile(filePath, data, "utf8");
}
//
/**
 * Checks if a resource is in the exceptions list.
 * @param {Array} exceptions - Loaded exceptions array.
 * @param {string} resourceType - Resource type (disk, vm, snapshot, ip).
 * @param {string} resourceName - Resource name.
 * @returns {boolean} True if the resource is an exception.
 */
function isException(exceptions, resourceType, resourceName) {
  return exceptions.some(e =>
    e.resourceType === resourceType && e.resourceName === resourceName
  );
}
//
/**
 * Adds a resource to the exceptions list and saves.
 * @param {string} configName - Configuration name.
 * @param {Array} exceptions - Current exceptions array (mutated in place).
 * @param {{resourceType: string, resourceName: string, zone: string, reason: string}} resource - Resource to add.
 * @returns {Promise<void>}
 */
async function addException(configName, exceptions, resource) {
  exceptions.push({
    resourceType: resource.resourceType,
    resourceName: resource.resourceName,
    zone: resource.zone || "",
    markedAt: new Date().toISOString(),
    reason: resource.reason || ""
  });
  await saveExceptions(configName, exceptions);
}
//
module.exports = {
  getExceptionsPath,
  loadExceptions,
  saveExceptions,
  isException,
  addException
};
