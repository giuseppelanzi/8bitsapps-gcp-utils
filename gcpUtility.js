#!/usr/bin/env node
const inquirer = require("inquirer");
const chalk = require("chalk");
const { listConfigurations } = require("./utils/configLoader.js");
const commands = require("./commands/index.js");
//
/**
 * Shows the main menu to select a command.
 * @returns {Promise<string>} Selected command name.
 */
async function showMainMenu() {
  const choices = commands.map((cmd, i) => ({
    name: `${i + 1}. ${cmd.description}`,
    value: cmd.name
  }));
  choices.push({ name: `${choices.length + 1}. Exit`, value: "exit" });
  //
  const { selected } = await inquirer.prompt([{
    type: "list",
    name: "selected",
    message: "Select command:",
    choices
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
    console.error("No configuration found in Configurations/.");
    process.exit(1);
  }
  //
  const choices = configs.map((cfg, i) => ({
    name: `${i + 1}. ${cfg}`,
    value: cfg
  }));
  //
  const { selected } = await inquirer.prompt([{
    type: "list",
    name: "selected",
    message: "Select configuration:",
    choices
  }]);
  //
  return selected;
}
//
/**
 * Main entry point.
 *  
  █   █  
   █ █   
  █████  
 ██ █ ██ 
█████████
█ █████ █
█ █████ █
   █ █   
  ██ ██  
 ██████  ███████  ██████  ██████     ██    ██████   ██████    ██████ 
██    ██ ██    ██   ██   ██    ██   ████   ██    ██ ██    ██ ██    ██
██    ██ ██    ██   ██   ██        ██  ██  ██    ██ ██    ██ ██      
 ██████  ███████    ██    ██████  ██    ██ ██████   ██████    ██████ 
██    ██ █     ██   ██         ██ ████████ ██       ██             ██
██    ██ ██    ██   ██   ██    ██ ██    ██ ██       ██       ██    ██
 ██████  ███████  ██████  ██████  ██    ██ ██       ██        ██████ 
 ====================================================================================

  █   █  
   █ █    | 
  █████   |  ██████  ███████  ██████  ██████     ██    ██████   ██████    ██████ 
 ██ █ ██  | ██    ██ ██    ██   ██   ██    ██   ████   ██    ██ ██    ██ ██    ██
█████████ | ██    ██ ██    ██   ██   ██        ██  ██  ██    ██ ██    ██ ██      
█ █████ █ |  ██████  ███████    ██    ██████  ██    ██ ██████   ██████    ██████ 
█ █████ █ | ██    ██ █     ██   ██         ██ ████████ ██       ██             ██
   █ █    | ██    ██ ██    ██   ██   ██    ██ ██    ██ ██       ██       ██    ██
  ██ ██   |  ██████  ███████  ██████  ██████  ██    ██ ██       ██        ██████ 

====================================================================================
 */
async function main() {
  console.log(
`=================================================

  █   █   | ${chalk.redBright("GCP Utiliy")}
   █ █    | 
  █████   | 
 ██ █ ██  | ${chalk.whiteBright.bold("8BitsApps")}
█████████ | 
█ █████ █ | We made app for fun! :D
█ █████ █ | ${chalk.cyan("https://8bitsapps.com")}
   █ █    | 
  ██ ██   | 

==================================================`);
  //
  const cmdName = await showMainMenu();
  //
  if (cmdName === "exit") {
    console.log("Goodbye!");
    return;
  }
  //
  const cmd = commands.find(c => c.name === cmdName);
  if (!cmd) {
    console.error(`Command not found: ${cmdName}`);
    process.exit(1);
  }
  //
  const configName = await showConfigMenu();
  //
  console.log(`\nRunning: ${cmd.description} with config: ${configName}\n`);
  //
  try {
    await cmd.execute(configName);
    console.log("\nCompleted.");
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }
}
//
main();
