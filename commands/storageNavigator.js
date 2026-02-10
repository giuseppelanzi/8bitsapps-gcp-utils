const path = require("path");
const inquirer = require("inquirer");
const Storage = require("../GCPUtilities/Storage.js");
const ListWithEscapePrompt = require("../utils/prompts/listWithEscape.js");
const { getSettings } = require("../utils/settings.js");
const ui = require("../utils/ui.js");
//
// Register custom prompt.
inquirer.registerPrompt("listWithEscape", ListWithEscapePrompt);
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
    const displayName = ui.getDisplayName(folder, currentPath);
    choices.push({
      name: `[D] ${displayName}`,
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
    const displayName = ui.getDisplayName(file.name, currentPath);
    const sizeStr = ui.formatSize(file.size);
    choices.push({
      name: `[F] ${displayName} (${sizeStr})`,
      value: { action: "file", value: file.name }
    });
    itemCount++;
  }
  //
  // Add separator and action options.
  if (choices.length > 0) {
    choices.push(new inquirer.Separator("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  }
  if (truncated) {
    choices.push(new inquirer.Separator(ui.formatTruncationNotice(maxItems)));
  }
  choices.push({
    name: ui.formatUploadChoice(),
    value: { action: "upload", value: currentPath }
  });
  choices.push({
    name: ui.formatCreateFolderChoice(),
    value: { action: "createFolder", value: currentPath }
  });
  //
  const message = backEnabled
    ? `${bucketName}:${displayPath} (\u2190 back, DEL delete, ESC exit)`
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
      ui.showError("No buckets configured. Add 'buckets' array or 'defaultBucket' to your configuration.");
      return;
    }
    //
    // Select bucket.
    const bucketName = await selectBucket(buckets);
    if (bucketName === null || bucketName?.action === "back") {
      return; // ESC or back arrow pressed.
    }
    // Position cursor at end of bucket selection line.
    ui.clearLineAbove();
    ui.writeInline(`? Select bucket (ESC exit): ${bucketName}`);
    //
    // Navigation loop.
    const pathHistory = [""];
    const operationLogs = [];
    //
    while (true) {
      ui.showOperationLog(operationLogs);
      operationLogs.length = 0;
      const currentPath = pathHistory[pathHistory.length - 1];
      //
      // List objects at current path.
      ui.showProgress(`Listing ${currentPath || "/"}`);
      let contents;
      try {
        contents = await storage.listObjects(bucketName, currentPath);
        // Clear the "Listing..." line (current line, no move up).
        ui.clearLine();
      } catch (err) {
        ui.writeInline("\n");
        ui.showError(`Error listing objects: ${err.message}`);
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
        const exitHint = backEnabled ? "(\u2190 back, DEL delete, ESC exit)" : "(DEL delete, ESC exit)";
        ui.overwriteLineAbove(`? ${bucketName}:${exitDisplayPath} ${exitHint} ${ui.formatExitLabel()}`);
        console.log();
        return;
      }
      //
      if (result.action === "back") {
        // Left arrow pressed - go back one level (only possible when backEnabled is true).
        const backDisplayPath = currentPath || "/";
        ui.overwriteLineAbove(`? ${bucketName}:${backDisplayPath} (\u2190 back, DEL delete, ESC exit) ${ui.formatBackLabel()}`);
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
        const itemName = ui.getDisplayName(itemPath, currentPath);
        //
        const confirmed = await confirmDelete(itemName, isFolder ? "folder" : "file");
        if (confirmed) {
          const itemType = isFolder ? "folder" : "file";
          ui.showProgress(`Deleting ${itemType} ${itemName}`);
          try {
            if (isFolder) {
              const count = await storage.deleteFolder(bucketName, itemPath);
              ui.clearLine();
              operationLogs.push({ type: "success", message: `Deleted folder "${itemName}" (${count} files)` });
            } else {
              await storage.deleteFile(bucketName, itemPath);
              ui.clearLine();
              operationLogs.push({ type: "success", message: `Deleted file "${itemName}"` });
            }
          } catch (err) {
            ui.clearLine();
            operationLogs.push({ type: "error", message: `Delete failed: ${itemName} - ${err.message}` });
          }
        }
        continue;
      }
      //
      switch (result.action) {
      case "folder": {
        // Force newline, then go back up and overwrite inquirer's colored line.
        const folderDisplayName = ui.getDisplayName(result.value, currentPath);
        const folderDisplayPath = currentPath || "/";
        ui.clearLineAbove();
        ui.writeInline(`? ${bucketName}:${folderDisplayPath} (\u2190 back, DEL delete, ESC exit) ${ui.formatFolderLabel(folderDisplayName)}`);
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
        ui.showProgress(`Downloading ${fileName}`);
        try {
          await storage.downloadFile(bucketName, result.value, localPath);
          // Clear the "Downloading..." line.
          ui.clearLine();
          operationLogs.push({ type: "success", message: `Downloaded: ${fileName} \u2192 ${localPath}` });
        } catch (err) {
          // Clear the "Downloading..." line.
          ui.clearLine();
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
          ui.showProgress(`Uploading ${uploadFileName}`);
          try {
            await storage.uploadFile(bucketName, uploadPath, remotePath);
            // Clear the "Uploading..." line.
            ui.clearLine();
            operationLogs.push({ type: "success", message: `Uploaded: ${uploadFileName} \u2192 ${bucketName}/${remotePath}` });
          } catch (err) {
            // Clear the "Uploading..." line.
            ui.clearLine();
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
          ui.showProgress(`Creating folder ${folderName}`);
          try {
            await storage.createFolder(bucketName, remotePath);
            // Clear the "Creating..." line.
            ui.clearLine();
            operationLogs.push({ type: "success", message: `Folder created: ${folderName} at ${bucketName}:${currentPath || "/"}` });
          } catch (err) {
            // Clear the "Creating..." line.
            ui.clearLine();
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
