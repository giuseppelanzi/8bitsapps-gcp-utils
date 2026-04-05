const inquirer = require("inquirer");
const Table = require("cli-table3");
const Compute = require("../GCPUtilities/Compute.js");
const ListWithEscapePrompt = require("../utils/prompts/listWithEscape.js");
const { getSettings } = require("../utils/settings.js");
const { loadExceptions, isException, addException } = require("../utils/exceptions.js");
const ui = require("../utils/ui.js");
const csvExporter = require("../utils/csvExporter.js");
const paths = require("../utils/paths.js");
//
// Register custom prompt.
inquirer.registerPrompt("listWithEscape", ListWithEscapePrompt);
//
// --- Domain-specific formatting (janitor knowledge stays here, not in ui.js). ---
//
/**
 * Applies color to a GCP resource status string.
 * @param {string} status - Resource status.
 * @returns {string} Chalk-formatted status string.
 */
function formatStatusColor(status) {
  const upper = (status || "").toUpperCase();
  if (["RUNNING", "IN_USE", "READY"].includes(upper)) {
    return ui.formatGreen(upper);
  }
  if (["STOPPED", "TERMINATED", "UNATTACHED"].includes(upper)) {
    return ui.formatRed(upper);
  }
  return ui.formatYellow(upper);
}
//
/**
 * Formats the zombie scan summary line.
 * @param {{disks: number, vms: number, snapshots: number, ips: number}} counts - Counts by type.
 * @returns {string} Formatted summary.
 */
function formatZombieSummary(counts) {
  const total = counts.disks + counts.vms + counts.snapshots + counts.ips;
  if (total === 0) {
    return ui.formatGreen("No zombie resources found.");
  }
  //
  const parts = [];
  if (counts.disks > 0) parts.push(`${counts.disks} unattached disk${counts.disks > 1 ? "s" : ""}`);
  if (counts.vms > 0) parts.push(`${counts.vms} stopped VM${counts.vms > 1 ? "s" : ""}`);
  if (counts.snapshots > 0) parts.push(`${counts.snapshots} orphaned snapshot${counts.snapshots > 1 ? "s" : ""}`);
  if (counts.ips > 0) parts.push(`${counts.ips} unused IP${counts.ips > 1 ? "s" : ""}`);
  //
  return ui.formatYellow(`Found ${total} zombie resource${total > 1 ? "s" : ""}: ${parts.join(", ")}.`);
}
//
// --- UX: Prompt and menu functions. ---
//
/**
 * Shows the Janitor main menu.
 * @returns {Promise<string|null>} Selected option or null on ESC.
 */
async function showJanitorMenu() {
  const choices = [
    { name: "1. Resource Inventory (Detail)", value: "inventory" },
    { name: "2. Zombie Items & Cleanup", value: "zombies" }
  ];
  //
  const { selected } = await inquirer.prompt([{
    type: "listWithEscape",
    name: "selected",
    message: "GCP Janitor (ESC to exit):",
    choices,
    enableBack: false
  }]);
  //
  return selected;
}
//
/**
 * Shows the resource inventory category menu.
 * @returns {Promise<string|null|{action: string}>} Selected category or null on ESC.
 */
async function showInventoryMenu() {
  const choices = [
    { name: "1. VM Instances (Servers)", value: "vms" },
    { name: "2. Persistent Disks (Global)", value: "disks" },
    { name: "3. Snapshots (Global)", value: "snapshots" },
    { name: "4. Static IP Addresses (Global)", value: "ips" }
  ];
  //
  const { selected } = await inquirer.prompt([{
    type: "listWithEscape",
    name: "selected",
    message: "Select resource type (\u2190 back, ESC to exit):",
    choices,
    enableBack: true
  }]);
  //
  return selected;
}
//
/**
 * Prompts for a name filter substring.
 * @param {string} resourceType - Resource type label.
 * @returns {Promise<string>} Filter string (empty means show all).
 */
async function promptNameFilter(resourceType) {
  const { filter } = await inquirer.prompt([{
    type: "input",
    name: "filter",
    message: ui.formatGray(`Filter ${resourceType} by name (leave empty for all):`)
  }]);
  //
  return (filter || "").trim().toLowerCase();
}
//
/**
 * Shows VM instances as a selectable list.
 * @param {Array} instances - Filtered instances.
 * @param {number} maxItems - Max items to display.
 * @returns {Promise<string|null|{action: string}>} Selected VM name or null/back.
 */
async function showVMList(instances, maxItems) {
  const truncated = instances.length > maxItems;
  const displayInstances = instances.slice(0, maxItems);
  //
  const choices = displayInstances.map((inst, i) => ({
    name: `${i + 1}. ${inst.name} (${inst.machineType}) [${inst.status}] ${inst.zone}`,
    value: inst.name
  }));
  //
  if (truncated) {
    choices.push(new inquirer.Separator(ui.formatTruncationNotice(maxItems)));
  }
  //
  choices.push(new inquirer.Separator("─"));
  choices.push({ name: ui.formatGreen("Export filtered VMs to CSV"), value: "__export_csv__" });
  //
  const { selected } = await inquirer.prompt([{
    type: "listWithEscape",
    name: "selected",
    message: "Select VM (\u2190 back, ESC to exit):",
    choices,
    enableBack: true
  }]);
  //
  return selected;
}
//
/**
 * Shows a disk selection menu within VM detail view.
 * @param {Array} attachedDisks - Disks attached to the VM.
 * @returns {Promise<string|null|{action: string}>} Selected disk name or null/back.
 */
async function showDiskListForVM(attachedDisks) {
  if (attachedDisks.length === 0) {
    return { action: "back" };
  }
  //
  const choices = attachedDisks.map((d, i) => ({
    name: `${i + 1}. ${d.name} (${d.sizeGb} GB, ${d.type})`,
    value: d.name
  }));
  //
  const { selected } = await inquirer.prompt([{
    type: "listWithEscape",
    name: "selected",
    message: "Select disk to view snapshots (\u2190 back, ESC to exit):",
    choices,
    enableBack: true
  }]);
  //
  return selected;
}
//
/**
 * Shows a menu to select a zombie resource to mark as exception.
 * @param {{unattachedDisks: Array, stoppedVMs: Array, orphanedSnapshots: Array, unusedIPs: Array}} zombies - Zombie data.
 * @returns {Promise<{resourceType: string, resourceName: string, zone: string}|null|{action: string}>}
 */
async function showZombieActionMenu(zombies) {
  const choices = [];
  let idx = 1;
  //
  for (const d of zombies.unattachedDisks) {
    choices.push({
      name: `${idx++}. [Disk] ${d.name} (${d.sizeGb} GB, ${d.zone})`,
      value: { resourceType: "disk", resourceName: d.name, zone: d.zone }
    });
  }
  for (const vm of zombies.stoppedVMs) {
    choices.push({
      name: `${idx++}. [VM] ${vm.name} (${vm.machineType}, ${vm.zone})`,
      value: { resourceType: "vm", resourceName: vm.name, zone: vm.zone }
    });
  }
  for (const s of zombies.orphanedSnapshots) {
    choices.push({
      name: `${idx++}. [Snapshot] ${s.name} (from ${s.sourceDisk})`,
      value: { resourceType: "snapshot", resourceName: s.name, zone: "" }
    });
  }
  for (const a of zombies.unusedIPs) {
    choices.push({
      name: `${idx++}. [IP] ${a.address} (${a.name}, ${a.region})`,
      value: { resourceType: "ip", resourceName: a.name, zone: a.region }
    });
  }
  //
  if (choices.length === 0) {
    return { action: "back" };
  }
  //
  const { selected } = await inquirer.prompt([{
    type: "listWithEscape",
    name: "selected",
    message: "Select resource to mark as exception (\u2190 back, ESC to exit):",
    choices,
    enableBack: true
  }]);
  //
  return selected;
}
//
/**
 * Prompts for an optional reason for the exception.
 * @returns {Promise<string>} Reason text or empty string.
 */
async function promptExceptionReason() {
  const { reason } = await inquirer.prompt([{
    type: "input",
    name: "reason",
    message: "Reason for exception (optional, press Enter to skip):"
  }]);
  //
  return (reason || "").trim();
}
//
// --- UI: Render and display functions. ---
//
/**
 * Renders a VM detail card with attached disks and static IPs.
 * @param {{instance: object, attachedDisks: Array, assignedIPs: Array}} detail - VM detail data.
 */
function renderVMDetailCard(detail) {
  const { instance, attachedDisks, assignedIPs } = detail;
  //
  // VM info table.
  ui.showSectionHeader("VM Instance");
  const vmTable = new Table({
    head: ["Field", "Value"],
    colWidths: [20, 50],
    style: { head: ["cyan"] }
  });
  vmTable.push(
    ["Name", instance.name],
    ["Machine Type", instance.machineType],
    ["Status", formatStatusColor(instance.status)],
    ["Zone", instance.zone],
    ["Last Start", ui.formatDate(instance.lastStart)],
    ["Created", ui.formatDate(instance.creationTimestamp)]
  );
  console.log(vmTable.toString());
  //
  // Attached disks table.
  ui.showSectionHeader("Attached Disks");
  if (attachedDisks.length === 0) {
    ui.showInfo("  No disks attached.");
  } else {
    const diskTable = new Table({
      head: ["#", "Name", "Size (GB)", "Type"],
      style: { head: ["cyan"] }
    });
    attachedDisks.forEach((d, i) => {
      diskTable.push([i + 1, d.name, d.sizeGb, d.type]);
    });
    console.log(diskTable.toString());
  }
  //
  // Static IPs table.
  ui.showSectionHeader("Static IPs");
  if (assignedIPs.length === 0) {
    ui.showInfo("  No static IPs assigned.");
  } else {
    const ipTable = new Table({
      head: ["IP Address", "Type", "Status"],
      style: { head: ["cyan"] }
    });
    assignedIPs.forEach(a => {
      ipTable.push([a.address, a.addressType, formatStatusColor(a.status)]);
    });
    console.log(ipTable.toString());
  }
}
//
/**
 * Renders a snapshots table.
 * @param {Array} snapshots - Snapshot data.
 * @param {string} title - Section title.
 */
function renderSnapshotsTable(snapshots, title) {
  ui.showSectionHeader(title);
  //
  if (snapshots.length === 0) {
    ui.showInfo("  No snapshots found.");
    return;
  }
  //
  const table = new Table({
    head: ["Name", "Creation Date", "Size (GB)", "Source Disk"],
    style: { head: ["cyan"] }
  });
  snapshots.forEach(s => {
    table.push([s.name, ui.formatDate(s.creationTimestamp), s.diskSizeGb, s.sourceDisk || "-"]);
  });
  console.log(table.toString());
}
//
/**
 * Renders the global disks table.
 * @param {Array} disks - All disks.
 * @param {Compute} computeInstance - Compute instance for helper methods.
 * @param {number} maxItems - Max rows.
 */
function renderDisksTable(disks, computeInstance, maxItems) {
  const truncated = disks.length > maxItems;
  const displayDisks = disks.slice(0, maxItems);
  //
  const table = new Table({
    head: ["Name", "Size (GB)", "Type", "Status", "Attached To"],
    style: { head: ["cyan"] }
  });
  displayDisks.forEach(d => {
    const attached = computeInstance.extractAttachedVMName(d.users);
    const statusDisplay = d.users.length > 0 ? "attached" : "unattached";
    table.push([d.name, d.sizeGb, d.type, formatStatusColor(statusDisplay), attached]);
  });
  console.log(table.toString());
  //
  if (truncated) {
    console.log(ui.formatTruncationNotice(maxItems));
  }
}
//
/**
 * Renders the global addresses table.
 * @param {Array} addresses - All addresses.
 * @param {Compute} computeInstance - Compute instance for helper methods.
 * @param {number} maxItems - Max rows.
 */
function renderAddressesTable(addresses, computeInstance, maxItems) {
  const truncated = addresses.length > maxItems;
  const displayAddresses = addresses.slice(0, maxItems);
  //
  const table = new Table({
    head: ["IP Address", "Name", "Region", "Type", "Status", "Used By"],
    style: { head: ["cyan"] }
  });
  displayAddresses.forEach(a => {
    const usedBy = computeInstance.extractUserName(a.users);
    table.push([a.address, a.name, a.region, a.addressType, formatStatusColor(a.status), usedBy]);
  });
  console.log(table.toString());
  //
  if (truncated) {
    console.log(ui.formatTruncationNotice(maxItems));
  }
}
//
/**
 * Renders the global snapshots table.
 * @param {Array} snapshots - All snapshots.
 * @param {number} maxItems - Max rows.
 */
function renderAllSnapshotsTable(snapshots, maxItems) {
  const truncated = snapshots.length > maxItems;
  const displaySnapshots = snapshots.slice(0, maxItems);
  //
  const table = new Table({
    head: ["Name", "Creation Date", "Size (GB)", "Source Disk", "Status"],
    style: { head: ["cyan"] }
  });
  displaySnapshots.forEach(s => {
    table.push([
      s.name,
      ui.formatDate(s.creationTimestamp),
      s.diskSizeGb,
      s.sourceDisk || "-",
      formatStatusColor(s.status)
    ]);
  });
  console.log(table.toString());
  //
  if (truncated) {
    console.log(ui.formatTruncationNotice(maxItems));
  }
}
//
/**
 * Renders the zombie resources report.
 * @param {{unattachedDisks: Array, stoppedVMs: Array, orphanedSnapshots: Array, unusedIPs: Array}} zombies - Zombie data.
 * @param {number} maxItems - Max rows per section.
 */
function renderZombieReport(zombies, maxItems) {
  // Summary line.
  console.log(formatZombieSummary({
    disks: zombies.unattachedDisks.length,
    vms: zombies.stoppedVMs.length,
    snapshots: zombies.orphanedSnapshots.length,
    ips: zombies.unusedIPs.length
  }));
  //
  const total = zombies.unattachedDisks.length + zombies.stoppedVMs.length +
    zombies.orphanedSnapshots.length + zombies.unusedIPs.length;
  if (total === 0) return;
  //
  // 1. Unattached disks.
  if (zombies.unattachedDisks.length > 0) {
    ui.showSectionHeader("Unattached Persistent Disks");
    const table = new Table({
      head: ["#", "Name", "Size (GB)", "Zone", "Created"],
      style: { head: ["cyan"] }
    });
    zombies.unattachedDisks.slice(0, maxItems).forEach((d, i) => {
      table.push([i + 1, d.name, d.sizeGb, d.zone, ui.formatDate(d.creationTimestamp)]);
    });
    console.log(table.toString());
  }
  //
  // 2. Long-stopped VMs.
  if (zombies.stoppedVMs.length > 0) {
    ui.showSectionHeader("Long-Stopped VM Instances");
    const table = new Table({
      head: ["#", "Name", "Days Stopped", "Machine Type", "Zone"],
      style: { head: ["cyan"] }
    });
    zombies.stoppedVMs.slice(0, maxItems).forEach((vm, i) => {
      const daysStr = ui.formatDaysAgo(vm.lastStart || vm.creationTimestamp);
      table.push([i + 1, vm.name, daysStr, vm.machineType, vm.zone]);
    });
    console.log(table.toString());
  }
  //
  // 3. Orphaned snapshots.
  if (zombies.orphanedSnapshots.length > 0) {
    ui.showSectionHeader("Orphaned Snapshots");
    const table = new Table({
      head: ["#", "Name", "Created", "Size (GB)", "Source Disk (MISSING)"],
      style: { head: ["cyan"] }
    });
    zombies.orphanedSnapshots.slice(0, maxItems).forEach((s, i) => {
      table.push([i + 1, s.name, ui.formatDate(s.creationTimestamp), s.diskSizeGb, s.sourceDisk]);
    });
    console.log(table.toString());
  }
  //
  // 4. Unused static IPs.
  if (zombies.unusedIPs.length > 0) {
    ui.showSectionHeader("Unused Static IP Addresses");
    const table = new Table({
      head: ["#", "IP Address", "Name", "Region", "Type"],
      style: { head: ["cyan"] }
    });
    zombies.unusedIPs.slice(0, maxItems).forEach((a, i) => {
      table.push([i + 1, a.address, a.name, a.region, a.addressType]);
    });
    console.log(table.toString());
  }
}
//
// --- Main command. ---
//
/**
 * GCP Janitor command.
 */
const command = {
  name: "gcpJanitor",
  description: "GCP Janitor - Resource Analyzer",
  //
  async execute(configName) {
    const computeInstance = new Compute(configName);
    const settings = getSettings();
    const maxItems = settings.janitor.maxItems;
    const thresholdDays = settings.janitor.stoppedVmThresholdDays;
    //
    // Cache fetched data to avoid repeated API calls within the session.
    let cachedInstances = null;
    let cachedDisks = null;
    let cachedSnapshots = null;
    let cachedAddresses = null;
    //
    /**
     * Fetches all resources (once per session, cached).
     */
    async function fetchAllResources() {
      if (cachedInstances !== null) return;
      //
      ui.showProgress("Scanning Compute Engine resources");
      const [instances, disks, snapshots, addresses] = await Promise.all([
        computeInstance.listInstances(),
        computeInstance.listDisks(),
        computeInstance.listSnapshots(),
        computeInstance.listAddresses()
      ]);
      ui.clearLine();
      //
      cachedInstances = instances;
      cachedDisks = disks;
      cachedSnapshots = snapshots;
      cachedAddresses = addresses;
    }
    //
    // Janitor main loop (Level 0).
    while (true) {
      const janitorChoice = await showJanitorMenu();
      //
      // ESC — exit janitor completely.
      if (janitorChoice === null) {
        return;
      }
      //
      if (janitorChoice === "inventory") {
        // Inventory sub-loop (Level 1).
        while (true) {
          const inventoryChoice = await showInventoryMenu();
          //
          if (inventoryChoice === null) {
            return; // ESC — exit completely.
          }
          if (inventoryChoice?.action === "back") {
            break; // Back to janitor menu.
          }
          //
          try {
            await fetchAllResources();
          } catch (err) {
            ui.showError(`Error fetching resources: ${err.message}`);
            break;
          }
          //
          if (inventoryChoice === "vms") {
            // VM hierarchical flow (Level 2).
            while (true) {
              const nameFilter = await promptNameFilter("VM instances");
              const filtered = cachedInstances.filter(i =>
                !nameFilter || i.name.toLowerCase().includes(nameFilter)
              );
              //
              if (filtered.length === 0) {
                ui.showWarning("No VM instances found matching filter.");
                break;
              }
              //
              const vmChoice = await showVMList(filtered, maxItems);
              //
              if (vmChoice === null) {
                return; // ESC.
              }
              if (vmChoice?.action === "back") {
                break; // Back to inventory menu.
              }
              //
              // Export filtered VMs to CSV.
              if (vmChoice === "__export_csv__") {
                ui.showProgress("Resolving machine type details");
                const mtCache = await computeInstance.resolveMachineTypes(filtered);
                ui.clearLine();
                //
                const headers = ["Name", "Machine Type", "vCPUs", "RAM (GB)", "Status", "Zone", "Last Start", "Created"];
                const rows = filtered.map(i => {
                  const specs = mtCache.get(i.machineType) || { vCPUs: "", memoryGb: "" };
                  return [
                    i.name, i.machineType, String(specs.vCPUs), String(specs.memoryGb),
                    i.status, i.zone,
                    ui.formatDate(i.lastStart), ui.formatDate(i.creationTimestamp)
                  ];
                });
                const exportPath = paths.getExportPath("vm-instances");
                const result = await csvExporter.exportToCsv(exportPath, headers, rows);
                ui.showSuccess(`Exported ${result.rowCount} VM instances to ${result.path}`);
                continue;
              }
              //
              // VM detail view (Level 3).
              const detail = computeInstance.getInstanceDetail(
                cachedInstances, cachedDisks, cachedSnapshots, cachedAddresses, vmChoice
              );
              if (!detail) {
                ui.showError("VM not found.");
                continue;
              }
              //
              renderVMDetailCard(detail);
              //
              // Disk drill-down loop (Level 3 -> Level 4).
              while (true) {
                const diskChoice = await showDiskListForVM(detail.attachedDisks);
                //
                if (diskChoice === null) {
                  return; // ESC.
                }
                if (diskChoice?.action === "back") {
                  break; // Back to VM list.
                }
                //
                // Show snapshots for selected disk (Level 4).
                const diskSnapshots = computeInstance.getDiskSnapshots(cachedSnapshots, diskChoice);
                renderSnapshotsTable(diskSnapshots, `Snapshots for disk: ${diskChoice}`);
                //
                // After viewing, wait for user to go back.
                const { selected } = await inquirer.prompt([{
                  type: "listWithEscape",
                  name: "selected",
                  message: "(\u2190 back, ESC to exit):",
                  choices: [{ name: "Back to disk list", value: "back" }],
                  enableBack: true
                }]);
                //
                if (selected === null) {
                  return; // ESC.
                }
                // Any other response goes back to disk list.
              }
            }
          } else if (inventoryChoice === "disks") {
            // Flat disks view.
            const nameFilter = await promptNameFilter("disks");
            const filtered = cachedDisks.filter(d =>
              !nameFilter || d.name.toLowerCase().includes(nameFilter)
            );
            ui.showSectionHeader("Persistent Disks");
            renderDisksTable(filtered, computeInstance, maxItems);
          } else if (inventoryChoice === "snapshots") {
            // Flat snapshots view.
            const nameFilter = await promptNameFilter("snapshots");
            const filtered = cachedSnapshots.filter(s =>
              !nameFilter || s.name.toLowerCase().includes(nameFilter)
            );
            ui.showSectionHeader("Snapshots");
            renderAllSnapshotsTable(filtered, maxItems);
          } else if (inventoryChoice === "ips") {
            // Flat IPs view.
            const nameFilter = await promptNameFilter("static IPs");
            const filtered = cachedAddresses.filter(a =>
              !nameFilter || a.name.toLowerCase().includes(nameFilter)
            );
            ui.showSectionHeader("Static IP Addresses");
            renderAddressesTable(filtered, computeInstance, maxItems);
          }
        }
        continue;
      }
      //
      if (janitorChoice === "zombies") {
        // Zombie detection flow.
        try {
          await fetchAllResources();
        } catch (err) {
          ui.showError(`Error fetching resources: ${err.message}`);
          continue;
        }
        //
        // Load exceptions.
        const exceptions = await loadExceptions(configName);
        //
        // Detect zombies.
        const rawZombies = computeInstance.findZombieResources(
          cachedInstances, cachedDisks, cachedSnapshots, cachedAddresses, thresholdDays
        );
        //
        // Filter out exceptions.
        const zombies = {
          unattachedDisks: rawZombies.unattachedDisks.filter(d =>
            !isException(exceptions, "disk", d.name)
          ),
          stoppedVMs: rawZombies.stoppedVMs.filter(vm =>
            !isException(exceptions, "vm", vm.name)
          ),
          orphanedSnapshots: rawZombies.orphanedSnapshots.filter(s =>
            !isException(exceptions, "snapshot", s.name)
          ),
          unusedIPs: rawZombies.unusedIPs.filter(a =>
            !isException(exceptions, "ip", a.name)
          )
        };
        //
        // Render report.
        renderZombieReport(zombies, maxItems);
        //
        // Exception marking loop.
        const total = zombies.unattachedDisks.length + zombies.stoppedVMs.length +
          zombies.orphanedSnapshots.length + zombies.unusedIPs.length;
        //
        if (total > 0) {
          while (true) {
            const actionChoice = await showZombieActionMenu(zombies);
            //
            if (actionChoice === null) {
              return; // ESC.
            }
            if (actionChoice?.action === "back") {
              break; // Back to janitor menu.
            }
            //
            // Mark as exception.
            const reason = await promptExceptionReason();
            await addException(configName, exceptions, {
              resourceType: actionChoice.resourceType,
              resourceName: actionChoice.resourceName,
              zone: actionChoice.zone,
              reason: reason
            });
            ui.showSuccess(`Marked "${actionChoice.resourceName}" as exception.`);
            //
            // Remove from the displayed zombies.
            if (actionChoice.resourceType === "disk") {
              const i = zombies.unattachedDisks.findIndex(d => d.name === actionChoice.resourceName);
              if (i >= 0) zombies.unattachedDisks.splice(i, 1);
            } else if (actionChoice.resourceType === "vm") {
              const i = zombies.stoppedVMs.findIndex(vm => vm.name === actionChoice.resourceName);
              if (i >= 0) zombies.stoppedVMs.splice(i, 1);
            } else if (actionChoice.resourceType === "snapshot") {
              const i = zombies.orphanedSnapshots.findIndex(s => s.name === actionChoice.resourceName);
              if (i >= 0) zombies.orphanedSnapshots.splice(i, 1);
            } else if (actionChoice.resourceType === "ip") {
              const i = zombies.unusedIPs.findIndex(a => a.name === actionChoice.resourceName);
              if (i >= 0) zombies.unusedIPs.splice(i, 1);
            }
            //
            // Check if any zombies remain.
            const remaining = zombies.unattachedDisks.length + zombies.stoppedVMs.length +
              zombies.orphanedSnapshots.length + zombies.unusedIPs.length;
            if (remaining === 0) {
              ui.showSuccess("All zombie resources have been marked as exceptions.");
              break;
            }
          }
        }
      }
    }
  }
};
//
module.exports = command;
