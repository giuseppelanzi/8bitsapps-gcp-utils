const path = require("path");
const inquirer = require("inquirer");
const chalk = require("chalk");
const Storage = require("../GCPUtils/Storage.js");
const ListWithEscapePrompt = require("../utils/prompts/listWithEscape.js");
const { getSettings } = require("../utils/settings.js");
//
// Register custom prompt.
inquirer.registerPrompt("listWithEscape", ListWithEscapePrompt);
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
/**
 * Shows bucket selection menu.
 * @param {Array<{name: string, displayName: string}>} buckets - List of buckets.
 * @returns {Promise<string|null>} Selected bucket name or null if ESC pressed.
 */
async function selectBucket(buckets) {
  if (buckets.length === 1) {
    return buckets[0].name;
  }
  //
  const choices = buckets.map((b, i) => ({
    name: `${i + 1}. ${b.displayName} (${b.name})`,
    value: b.name
  }));
  //
  const { selected } = await inquirer.prompt([{
    type: "listWithEscape",
    name: "selected",
    message: "Select bucket (← back, ESC exit):",
    choices
  }]);
  //
  return selected;
}
//
/**
 * Shows folder/file navigation menu.
 * @param {string} bucketName - Current bucket.
 * @param {string} currentPath - Current path prefix.
 * @param {{folders: string[], files: Array<{name: string, size: number}>}} contents - Folder contents.
 * @returns {Promise<{action: string, value: string}|null>} Selected action or null if ESC pressed.
 */
async function showNavigationMenu(bucketName, currentPath, contents, maxItems) {
  const displayPath = currentPath || "/";
  const choices = [];
  let itemCount = 0;
  let truncated = false;
  //
  // Add folders (limited by maxItems).
  for (const folder of contents.folders) {
    if (itemCount >= maxItems) {
      truncated = true;
      break;
    }
    const displayName = getDisplayName(folder, currentPath);
    choices.push({
      name: chalk.blue(`[D] ${displayName}`),
      value: { action: "folder", value: folder }
    });
    itemCount++;
  }
  //
  // Add files (limited by maxItems).
  for (const file of contents.files) {
    if (itemCount >= maxItems) {
      truncated = true;
      break;
    }
    const displayName = getDisplayName(file.name, currentPath);
    const sizeStr = formatSize(file.size);
    choices.push({
      name: `[F] ${displayName} (${sizeStr})`,
      value: { action: "file", value: file.name }
    });
    itemCount++;
  }
  //
  // Add separator and upload option.
  if (choices.length > 0) {
    choices.push(new inquirer.Separator("─────────────"));
  }
  if (truncated) {
    choices.push(new inquirer.Separator(chalk.yellow(`(showing first ${maxItems} items)`)));
  }
  choices.push({
    name: chalk.green("Upload file here"),
    value: { action: "upload", value: currentPath }
  });
  //
  const { selected } = await inquirer.prompt([{
    type: "listWithEscape",
    name: "selected",
    message: `${bucketName}:${displayPath} (← back, ESC exit)`,
    choices
  }]);
  //
  return selected;
}
//
/**
 * Prompts for local file path to upload.
 * @returns {Promise<string|null>} Local file path or null if cancelled.
 */
async function promptUploadPath() {
  const { filePath } = await inquirer.prompt([{
    type: "input",
    name: "filePath",
    message: "Enter local file path to upload (or leave empty to cancel):"
  }]);
  //
  return filePath || null;
}
//
/**
 * Shows the operation log section.
 * @param {Array<{type: string, message: string}>} logs - Array of log entries.
 */
function showOperationLog(logs) {
  if (logs.length === 0) return;
  //
  console.log(chalk.gray("════════════════════════════════════════"));
  console.log(chalk.gray(" OPERATION LOG"));
  console.log(chalk.gray("════════════════════════════════════════"));
  for (const log of logs) {
    if (log.type === "success") {
      console.log(chalk.green(` ✓ ${log.message}`));
    } else if (log.type === "error") {
      console.log(chalk.red(` ✗ ${log.message}`));
    } else {
      console.log(chalk.gray(` · ${log.message}`));
    }
  }
  console.log(chalk.gray("════════════════════════════════════════\n"));
}
//
/**
 * Storage Navigator command.
 */
const command = {
  name: "storageNavigator",
  description: "Browse and manage GCS storage",
  //
  async execute(configName) {
    const storage = new Storage(configName);
    const settings = getSettings();
    const maxItems = settings.storage.maxItems;
    //
    // Get available buckets.
    const buckets = await storage.getBuckets();
    if (buckets.length === 0) {
      console.log(chalk.red("No buckets configured. Add 'buckets' array or 'defaultBucket' to your configuration."));
      return;
    }
    //
    // Select bucket.
    const bucketName = await selectBucket(buckets);
    if (bucketName === null || bucketName?.action === "back") {
      return; // ESC or back arrow pressed.
    }
    //
    // Navigation loop.
    const pathHistory = [""];
    const operationLogs = [];
    //
    while (true) {
      showOperationLog(operationLogs);
      const currentPath = pathHistory[pathHistory.length - 1];
      //
      // List objects at current path.
      process.stdout.write(chalk.yellow(`⏳ Listing ${currentPath || "/"}...`));
      let contents;
      try {
        contents = await storage.listObjects(bucketName, currentPath);
        // Clear the "Listing..." line.
        process.stdout.write("\x1b[2K\x1b[G");
      } catch (err) {
        process.stdout.write("\n");
        console.log(chalk.red(`Error listing objects: ${err.message}`));
        return;
      }
      //
      // Show navigation menu.
      const result = await showNavigationMenu(bucketName, currentPath, contents, maxItems);
      //
      if (result === null) {
        // ESC pressed - exit storage navigator completely.
        return;
      }
      //
      if (result.action === "back") {
        // Left arrow pressed - go back one level.
        if (pathHistory.length > 1) {
          pathHistory.pop();
          continue;
        } else {
          // At root, exit navigator.
          return;
        }
      }
      //
      switch (result.action) {
        case "folder":
          // Enter folder.
          pathHistory.push(result.value);
          break;
        //
        case "file":
          // Download file.
          const fileName = path.basename(result.value);
          const localPath = path.join(process.cwd(), fileName);
          //
          console.log(chalk.yellow(`\n⏳ Downloading ${fileName}...`));
          try {
            await storage.downloadFile(bucketName, result.value, localPath);
            operationLogs.push({ type: "success", message: `Downloaded: ${fileName} → ${localPath}` });
          } catch (err) {
            operationLogs.push({ type: "error", message: `Download failed: ${fileName} - ${err.message}` });
          }
          break;
        //
        case "upload":
          // Upload file.
          const uploadPath = await promptUploadPath();
          if (uploadPath) {
            const uploadFileName = path.basename(uploadPath);
            const remotePath = currentPath + uploadFileName;
            //
            console.log(chalk.yellow(`\n⏳ Uploading ${uploadFileName}...`));
            try {
              await storage.uploadFile(bucketName, uploadPath, remotePath);
              operationLogs.push({ type: "success", message: `Uploaded: ${uploadFileName} → ${bucketName}/${remotePath}` });
            } catch (err) {
              operationLogs.push({ type: "error", message: `Upload failed: ${uploadFileName} - ${err.message}` });
            }
          }
          break;
      }
    }
  }
};
//
module.exports = command;
