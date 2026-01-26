const path = require("path");
const inquirer = require("inquirer");
const chalk = require("chalk");
const Storage = require("../GCPUtilities/Storage.js");
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
    message: "Select bucket (ESC exit):",
    choices,
    enableBack: false
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
 * @param {{maxItems: number, backEnabled: boolean}} options - Menu options.
 * @returns {Promise<{action: string, value: string}|null>} Selected action or null if ESC pressed.
 */
async function showNavigationMenu(bucketName, currentPath, contents, options) {
  const { maxItems, backEnabled } = options;
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
    name: chalk.green("↑ Upload file here"),
    value: { action: "upload", value: currentPath }
  });
  choices.push({
    name: chalk.green("+ Create folder here"),
    value: { action: "createFolder", value: currentPath }
  });
  //
  const message = backEnabled
    ? `${bucketName}:${displayPath} (← back, DEL delete, ESC exit)`
    : `${bucketName}:${displayPath} (DEL delete, ESC exit)`;
  //
  const { selected } = await inquirer.prompt([{
    type: "listWithEscape",
    name: "selected",
    message,
    choices,
    enableBack: backEnabled,
    deleteFilter: (value) => value?.action === "file" || value?.action === "folder"
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
 * Prompts for folder name to create.
 * @returns {Promise<string|null>} Folder name or null if cancelled.
 */
async function promptFolderName() {
  const { folderName } = await inquirer.prompt([{
    type: "input",
    name: "folderName",
    message: "Enter folder name (or leave empty to cancel):",
    validate: (input) => {
      if (!input.trim()) return true;
      if (input.includes("/")) return "Folder name cannot contain /";
      return true;
    }
  }]);
  //
  return folderName.trim() || null;
}
//
/**
 * Prompts for delete confirmation.
 * @param {string} itemName - Name of the item to delete.
 * @param {string} itemType - Type of item ("file" or "folder").
 * @returns {Promise<boolean>} True if confirmed.
 */
async function confirmDelete(itemName, itemType) {
  const { confirmed } = await inquirer.prompt([{
    type: "confirm",
    name: "confirmed",
    message: `Delete ${itemType} "${itemName}"?`,
    default: false
  }]);
  return confirmed;
}
//
/**
 * Shows the operation log section.
 * @param {Array<{type: string, message: string}>} logs - Array of log entries.
 */
function showOperationLog(logs) {
  if (logs.length === 0) return;
  //
  for (const log of logs) {
    if (log.type === "success") {
      console.log(chalk.green(` ✓ ${log.message}`));
    } else if (log.type === "error") {
      console.log(chalk.red(` ✗ ${log.message}`));
    } else {
      console.log(chalk.gray(` · ${log.message}`));
    }
  }
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
    // Position cursor at end of bucket selection line.
    process.stdout.write("\x1b[1A\x1b[2K\x1b[G");
    process.stdout.write(`? Select bucket (ESC exit): ${bucketName}`);
    //
    // Navigation loop.
    const pathHistory = [""];
    const operationLogs = [];
    //
    while (true) {
      showOperationLog(operationLogs);
      operationLogs.length = 0;
      const currentPath = pathHistory[pathHistory.length - 1];
      //
      // List objects at current path.
      process.stdout.write(chalk.yellow(`\n⏳ Listing ${currentPath || "/"}...`));
      let contents;
      try {
        contents = await storage.listObjects(bucketName, currentPath);
        // Clear the "Listing..." line (current line, no move up).
        process.stdout.write("\x1b[2K\x1b[G");
      } catch (err) {
        process.stdout.write("\n");
        console.log(chalk.red(`Error listing objects: ${err.message}`));
        return;
      }
      //
      // Show navigation menu.
      const backEnabled = pathHistory.length > 1;
      const result = await showNavigationMenu(bucketName, currentPath, contents, { maxItems, backEnabled });
      //
      if (result === null) {
        // ESC pressed - exit storage navigator completely.
        const exitDisplayPath = currentPath || "/";
        const exitHint = backEnabled ? "(← back, DEL delete, ESC exit)" : "(DEL delete, ESC exit)";
        process.stdout.write(`\x1b[1A\x1b[2K\x1b[G? ${bucketName}:${exitDisplayPath} ${exitHint} ${chalk.red("<- exit")}`);
        console.log();
        return;
      }
      //
      if (result.action === "back") {
        // Left arrow pressed - go back one level (only possible when backEnabled is true).
        const backDisplayPath = currentPath || "/";
        process.stdout.write(`\x1b[1A\x1b[2K\x1b[G? ${bucketName}:${backDisplayPath} (← back, DEL delete, ESC exit) ${chalk.cyan("<- back")}`);
        pathHistory.pop();
        continue;
      }
      //
      if (result.action === "delete") {
        const selectedValue = result.value;
        // Skip if not a file or folder (e.g., upload/createFolder option).
        if (!selectedValue?.action || (selectedValue.action !== "file" && selectedValue.action !== "folder")) {
          continue;
        }
        //
        const isFolder = selectedValue.action === "folder";
        const itemPath = selectedValue.value;
        const itemName = getDisplayName(itemPath, currentPath);
        //
        const confirmed = await confirmDelete(itemName, isFolder ? "folder" : "file");
        if (confirmed) {
          const itemType = isFolder ? "folder" : "file";
          process.stdout.write(chalk.yellow(`\n⏳ Deleting ${itemType} ${itemName}...`));
          try {
            if (isFolder) {
              const count = await storage.deleteFolder(bucketName, itemPath);
              process.stdout.write("\x1b[2K\x1b[G");
              operationLogs.push({ type: "success", message: `Deleted folder "${itemName}" (${count} files)` });
            } else {
              await storage.deleteFile(bucketName, itemPath);
              process.stdout.write("\x1b[2K\x1b[G");
              operationLogs.push({ type: "success", message: `Deleted file "${itemName}"` });
            }
          } catch (err) {
            process.stdout.write("\x1b[2K\x1b[G");
            operationLogs.push({ type: "error", message: `Delete failed: ${itemName} - ${err.message}` });
          }
        }
        continue;
      }
      //
      switch (result.action) {
      case "folder": {
        // Force newline, then go back up and overwrite inquirer's colored line.
        const folderDisplayName = getDisplayName(result.value, currentPath);
        const folderDisplayPath = currentPath || "/";
        process.stdout.write("\x1b[1A\x1b[2K\x1b[G");
        process.stdout.write(`? ${bucketName}:${folderDisplayPath} (← back, DEL delete, ESC exit) ${chalk.cyan(`[D] ${folderDisplayName}`)}`);
        // Enter folder.
        pathHistory.push(result.value);
        break;
      }
      //
      case "file": {
        // Download file.
        const fileName = path.basename(result.value);
        const localPath = path.join(process.cwd(), fileName);
        //
        process.stdout.write(chalk.yellow(`\n⏳ Downloading ${fileName}...`));
        try {
          await storage.downloadFile(bucketName, result.value, localPath);
          // Clear the "Downloading..." line.
          process.stdout.write("\x1b[2K\x1b[G");
          operationLogs.push({ type: "success", message: `Downloaded: ${fileName} → ${localPath}` });
        } catch (err) {
          // Clear the "Downloading..." line.
          process.stdout.write("\x1b[2K\x1b[G");
          operationLogs.push({ type: "error", message: `Download failed: ${fileName} - ${err.message}` });
        }
        break;
      }
      //
      case "upload": {
        // Upload file.
        const uploadPath = await promptUploadPath();
        if (uploadPath) {
          const uploadFileName = path.basename(uploadPath);
          const remotePath = currentPath + uploadFileName;
          //
          process.stdout.write(chalk.yellow(`\n⏳ Uploading ${uploadFileName}...`));
          try {
            await storage.uploadFile(bucketName, uploadPath, remotePath);
            // Clear the "Uploading..." line.
            process.stdout.write("\x1b[2K\x1b[G");
            operationLogs.push({ type: "success", message: `Uploaded: ${uploadFileName} → ${bucketName}/${remotePath}` });
          } catch (err) {
            // Clear the "Uploading..." line.
            process.stdout.write("\x1b[2K\x1b[G");
            operationLogs.push({ type: "error", message: `Upload failed: ${uploadFileName} - ${err.message}` });
          }
        }
        break;
      }
      //
      case "createFolder": {
        // Create folder.
        const folderName = await promptFolderName();
        if (folderName) {
          const remotePath = currentPath + folderName + "/";
          //
          process.stdout.write(chalk.yellow(`\n⏳ Creating folder ${folderName}...`));
          try {
            await storage.createFolder(bucketName, remotePath);
            // Clear the "Creating..." line.
            process.stdout.write("\x1b[2K\x1b[G");
            operationLogs.push({ type: "success", message: `Folder created: ${folderName} at ${bucketName}:${currentPath || "/"}` });
          } catch (err) {
            // Clear the "Creating..." line.
            process.stdout.write("\x1b[2K\x1b[G");
            operationLogs.push({ type: "error", message: `Create folder failed: ${folderName} - ${err.message}` });
          }
        }
        break;
      }
      }
    }
  }
};
//
module.exports = command;
