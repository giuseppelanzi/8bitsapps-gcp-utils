#!/usr/bin/env node
const fs = require("fs");
const inquirer = require("inquirer");
const chalk = require("chalk");
const { isLocalMode, getConfigurationsDir, getConfigPath } = require("./utils/paths.js");
const { listConfigurations } = require("./utils/configLoader.js");
const { describeAuthError, describeIdentityMismatch, isLegacyKeyAuth } = require("./utils/gcpAuth.js");
const commands = require("./commands/index.js");
const ListWithEscapePrompt = require("./utils/prompts/listWithEscape.js");
const { checkForUpdates } = require("./utils/updateChecker.js");
const {
  writeInline, formatGray, blankLine,
  showError, showWarning, showInfo, showSuccess
} = require("./utils/ui.js");
//
const packageJson = require("./package.json");
const boxWidth = 71;
//
// Register custom prompt with ESC support.
inquirer.registerPrompt("listWithEscape", ListWithEscapePrompt);
//
/**
 * Shows the main menu to select a command.
 * @returns {Promise<string>} Selected command name.
 */
async function showMainMenu() {
  // Filter out init command from numbered list.
  const regularCommands = commands.filter(cmd => cmd.name !== "init");
  const choices = regularCommands.map((cmd, i) => ({
    name: `${i + 1}. ${cmd.description}`,
    value: cmd.name
  }));
  // Add init option with "." prefix.
  choices.push({ name: ".. Initialize repository", value: "init" });
  //
  const { selected } = await inquirer.prompt([{
    type: "listWithEscape",
    name: "selected",
    message: "Select command (ESC to exit):",
    choices,
    enableBack: false
  }]);
  //
  return selected;
}
//
/**
 * Shows the configuration selection menu.
 * @returns {Promise<string>} Selected configuration name.
 */
async function showConfigMenu() {
  const configs = await listConfigurations();
  //
  if (configs.length === 0) {
    showError(`No configuration found in ${getConfigurationsDir()}/.`);
    return null;
  }
  //
  const choices = configs.map((cfg, i) => ({
    name: `${i + 1}. ${cfg}`,
    value: cfg
  }));
  //
  const { selected } = await inquirer.prompt([{
    type: "listWithEscape",
    name: "selected",
    message: "Select configuration (ESC to go back):",
    choices,
    enableBack: false
  }]);
  //
  return selected;
}
//
/**
 * Warns about deprecated credentials or credentials that contradict the configuration.
 * @param {string} configName - Selected configuration name.
 */
async function warnOnAuthIssues(configName) {
  try {
    const configuration = JSON.parse(await fs.promises.readFile(getConfigPath(configName), "utf8"));
    if (isLegacyKeyAuth(configuration)) {
      showWarning(`Configuration "${configName}" uses a static service account key.`);
      showWarning("Migrate to \"auth.identity\" and delete the key from the GCP console.");
      blankLine();
      return;
    }
    const mismatch = describeIdentityMismatch(configuration);
    if (mismatch) {
      showWarning(mismatch);
      blankLine();
    }
  } catch {
    // A broken configuration surfaces later, with a better message.
  }
}
//
/**
 * Checks if the configuration directory is initialized.
 * @returns {Promise<boolean>} True if initialized with at least one config.
 */
async function isInitialized() {
  try {
    await fs.promises.access(getConfigurationsDir());
    const configs = await listConfigurations();
    return configs.length > 0;
  } catch {
    return false;
  }
}
//
/**
 * Waits for user to press ENTER or ESC to continue.
 */
async function waitForKeypress() {
  return new Promise((resolve) => {
    const readline = require("readline");
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    //
    writeInline(formatGray("Press ENTER or ESC to continue...") + "\n");
    //
    process.stdin.once("keypress", (_str, _key) => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      resolve();
    });
  });
}
//
/**
 * Shows the application banner.
 */
function showBanner() {
  const mode = isLocalMode() ? "local" : "global";
  writeInline(
    `${chalk.hex("#F77B00")("=".repeat(boxWidth))}
${chalk.hex("#FFFFFF")("       █     █    ")}   |
${chalk.hex("#ffff00")("        █   █     ")}   |
${chalk.hex("#fffF00")("       ███████    ")}   |    ${chalk.hex("#F77B00").bold("GCP Utils")} ${chalk.gray(`v${packageJson.version}`)}
${chalk.hex("#FFCE00")("     ███  █  ███  ")}   |    by ${chalk.whiteBright.bold("8BitsApps")} - ${chalk.hex("#FFCE00")("https://8bitsapps.com")}
${chalk.hex("#FFCE00")("    █████████████ ")}   |
${chalk.hex("#F77B00")("    █  ███████  █ ")}   |    ${chalk.bgHex("#FFCE00").hex("#000000")("We make app for fun! (ツ)")}
${chalk.hex("#F77B00")("    █  ███████  █ ")}   |    Support us - ${chalk.hex("#FFCE00")("https://ko-fi.com/8bitsapps")}
${chalk.hex("#E73100")("        █   █     ")}   |
${chalk.hex("#E73100")("       ██   ██    ")}   |    ${chalk.gray(`Mode:${mode}`)}
${chalk.hex("#F77B00")("_".repeat(boxWidth))}\n`);
  blankLine();
}
//
/**
 * Shows update notification if a new version is available.
 * @param {{available: boolean, current: string, latest: string}|null} updateInfo
 */
function showUpdateNotification(updateInfo) {
  if (!updateInfo || !updateInfo.available) {
    return;
  }
  //
  const msg = `Update available: ${updateInfo.current} → ${updateInfo.latest}`;
  const cmd = `npm install -g ${packageJson.name}`;
  const sudoWrn = "(sudo might be required)";
  //
  writeInline(chalk.white(`  ${msg}`) + "\n");
  writeInline(chalk.gray(`  Run: ${chalk.cyan(cmd)}`) + "\n");
  writeInline(chalk.gray(`       ${chalk.cyan(sudoWrn)}`) + "\n");
  writeInline(chalk.hex("#FFCE00")("_".repeat(boxWidth)) + "\n");
  blankLine();
}
//
/**
 * Main entry point.
 */
async function main() {
  console.clear();
  //
  // Start update check in background (non-blocking).
  const updateCheckPromise = checkForUpdates();
  //
  // Check if initialized.
  if (!(await isInitialized())) {
    showWarning("Configuration not found.");
    writeInline(`Run ${chalk.cyan("gcpUtils")} after initialization to use the tool.\n`);
    blankLine();
    //
    const { shouldInit } = await inquirer.prompt([{
      type: "confirm",
      name: "shouldInit",
      message: "Would you like to initialize now?",
      default: true
    }]);
    //
    if (shouldInit) {
      const initCmd = commands.find(c => c.name === "init");
      await initCmd.execute();
    }
    return;
  }
  //
  // Wait for update check with timeout (max 2s).
  let updateInfo = null;
  try {
    updateInfo = await Promise.race([
      updateCheckPromise,
      new Promise(resolve => setTimeout(() => resolve(null), 2000))
    ]);
  } catch {
    // Ignore errors.
  }
  //
  while (true) {
    console.clear();
    showBanner();
    //
    // Show update notification only on first iteration.
    if (updateInfo) {
      showUpdateNotification(updateInfo);
      updateInfo = null;
    }
    //
    const cmdName = await showMainMenu();
    //
    // ESC pressed in main menu - exit.
    if (cmdName === null) {
      showInfo("Goodbye!");
      return;
    }
    //
    if (cmdName === "init") {
      const initCmd = commands.find(c => c.name === "init");
      await initCmd.execute();
      blankLine();
      blankLine();
      await waitForKeypress();
      continue;
    }
    //
    const cmd = commands.find(c => c.name === cmdName);
    if (!cmd) {
      showError(`Command not found: ${cmdName}`);
      continue;
    }
    //
    const configName = await showConfigMenu();
    //
    // ESC pressed in config menu - go back to main menu.
    if (configName === null) {
      continue;
    }
    //
    blankLine();
    showInfo(`Running: ${cmd.description} with config: ${configName}`);
    blankLine();
    await warnOnAuthIssues(configName);
    //
    try {
      await cmd.execute(configName);
      blankLine();
      showSuccess("Completed.");
      blankLine();
    } catch (err) {
      blankLine();
      showError(`Error: ${err.message}`);
      const authHint = describeAuthError(err);
      if (authHint) {
        showWarning(authHint);
      }
      blankLine();
    }
    await waitForKeypress();
  }
}
//
main();
