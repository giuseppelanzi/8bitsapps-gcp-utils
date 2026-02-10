const chalk = require("chalk");
//
// --- ANSI terminal helpers. ---
//
/**
 * Clears the current line and moves cursor to column 0.
 */
function clearLine() {
  process.stdout.write("\x1b[2K\x1b[G");
}
//
/**
 * Moves cursor up one line, clears it, and moves cursor to column 0.
 */
function clearLineAbove() {
  process.stdout.write("\x1b[1A\x1b[2K\x1b[G");
}
//
/**
 * Moves cursor up one line, clears it, and writes a message in its place.
 * @param {string} message - The message to write on the cleared line.
 */
function overwriteLineAbove(message) {
  process.stdout.write(`\x1b[1A\x1b[2K\x1b[G${message}`);
}
//
/**
 * Writes text to stdout without a trailing newline.
 * @param {string} text - Text to write.
 */
function writeInline(text) {
  process.stdout.write(text);
}
//
// --- Progress indicators. ---
//
/**
 * Shows a progress indicator with leading newline.
 * @param {string} message - Progress message (without trailing dots).
 */
function showProgress(message) {
  process.stdout.write(chalk.yellow(`\n\u23f3 ${message}...`));
}
//
// --- Formatting helpers. ---
//
/**
 * Formats file size in human readable format.
 * @param {number} bytes - Size in bytes.
 * @returns {string} Formatted size.
 */
function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
//
/**
 * Extracts the display name from a full path.
 * @param {string} fullPath - The full path.
 * @param {string} prefix - The current prefix.
 * @returns {string} The display name.
 */
function getDisplayName(fullPath, prefix) {
  return fullPath.slice(prefix.length);
}
//
// --- Operation log rendering. ---
//
/**
 * Renders operation log entries with colored symbols.
 * @param {Array<{type: string, message: string}>} logs - Log entries.
 */
function showOperationLog(logs) {
  if (logs.length === 0) return;
  //
  for (const log of logs) {
    if (log.type === "success") {
      console.log(chalk.green(` \u2713 ${log.message}`));
    } else if (log.type === "error") {
      console.log(chalk.red(` \u2717 ${log.message}`));
    } else {
      console.log(chalk.gray(` \u00b7 ${log.message}`));
    }
  }
}
//
// --- Menu choice formatting. ---
//
/**
 * Formats the "Upload file here" menu choice.
 * @returns {string} Chalk-formatted string.
 */
function formatUploadChoice() {
  return chalk.green("\u2191 Upload file here");
}
//
/**
 * Formats the "Create folder here" menu choice.
 * @returns {string} Chalk-formatted string.
 */
function formatCreateFolderChoice() {
  return chalk.green("+ Create folder here");
}
//
/**
 * Formats a truncation notice for menus.
 * @param {number} maxItems - Maximum items shown.
 * @returns {string} Chalk-formatted string.
 */
function formatTruncationNotice(maxItems) {
  return chalk.yellow(`(showing first ${maxItems} items)`);
}
//
// --- Navigation labels. ---
//
/**
 * Formats the "exit" label for navigation trail.
 * @returns {string} Chalk-formatted exit label.
 */
function formatExitLabel() {
  return chalk.red("<- exit");
}
//
/**
 * Formats the "back" label for navigation trail.
 * @returns {string} Chalk-formatted back label.
 */
function formatBackLabel() {
  return chalk.cyan("<- back");
}
//
/**
 * Formats a folder name for the navigation trail.
 * @param {string} folderDisplayName - Display name of folder.
 * @returns {string} Chalk-formatted folder label.
 */
function formatFolderLabel(folderDisplayName) {
  return chalk.cyan(`[D] ${folderDisplayName}`);
}
//
// --- Messages. ---
//
/**
 * Prints an error message in red.
 * @param {string} message - Error message.
 */
function showError(message) {
  console.log(chalk.red(message));
}
//
/**
 * Prints an info message in cyan.
 * @param {string} message - Info message.
 */
function showInfo(message) {
  console.log(chalk.cyan(message));
}
//
/**
 * Prints a success message in green.
 * @param {string} message - Success message.
 */
function showSuccess(message) {
  console.log(chalk.green(message));
}
//
/**
 * Prints a warning message in yellow.
 * @param {string} message - Warning message.
 */
function showWarning(message) {
  console.log(chalk.yellow(message));
}
//
module.exports = {
  // ANSI helpers.
  clearLine,
  clearLineAbove,
  overwriteLineAbove,
  writeInline,
  // Progress.
  showProgress,
  // Formatting.
  formatSize,
  getDisplayName,
  // Operation log.
  showOperationLog,
  // Menu choices.
  formatUploadChoice,
  formatCreateFolderChoice,
  formatTruncationNotice,
  // Navigation labels.
  formatExitLabel,
  formatBackLabel,
  formatFolderLabel,
  // Messages.
  showError,
  showInfo,
  showSuccess,
  showWarning
};
