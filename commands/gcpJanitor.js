const inquirer = require("inquirer");
const Table = require("cli-table3");
const Compute = require("../GCPUtilities/Compute.js");
const ListWithEscapePrompt = require("../utils/prompts/listWithEscape.js");
const FilterableListPrompt = require("../utils/prompts/filterableList.js");
const { getSettings } = require("../utils/settings.js");
const { loadExceptions, isException, addException } = require("../utils/exceptions.js");
const ui = require("../utils/ui.js");
const csvExporter = require("../utils/csvExporter.js");
const paths = require("../utils/paths.js");
//
// Register custom prompts.
inquirer.registerPrompt("listWithEscape", ListWithEscapePrompt);
inquirer.registerPrompt("filterableList", FilterableListPrompt);
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
 * Shows VM instances as a live-filterable list.
 * @param {Array} instances - All instances.
 * @param {{maxItems: number, pageStep: number}} options - Window options.
 * @returns {Promise<{selected: string|null|{action: string}, filterTerm: string}>} Selection and active filter term.
 */
async function showVMList(instances, options) {
  const state = {};
  const source = instances.map((inst, i) => ({
    name: `${i + 1}. ${inst.name} (${inst.machineType}) [${inst.status}] ${inst.zone}`,
    value: inst.name,
    search: inst.name.toLowerCase()
  }));
  //
  const footer = [
    new inquirer.Separator("─"),
    { name: ui.formatGreen("Export filtered VMs to CSV"), value: "__export_csv__" }
  ];
  //
  const { selected } = await inquirer.prompt([{
    type: "filterableList",
    name: "selected",
    message: "Select VM (type to filter, \u2190 back, ESC to exit):",
    source,
    footer,
    pageWindow: options.maxItems,
    pageStep: options.pageStep,
    enableBack: true,
    state,
    formatLoadMore: ui.formatLoadMore,
    noMatchesText: ui.formatNoMatches
  }]);
  //
  return { selected, filterTerm: state.filterTerm || "" };
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
 * Shows a filterable menu to select a zombie resource to mark as exception.
 * The type tag is part of the search text, so typing "disk" or "vm" filters by kind.
 * @param {{unattachedDisks: Array, stoppedVMs: Array, orphanedSnapshots: Array, unusedIPs: Array}} zombies - Zombie data.
 * @param {{maxItems: number, pageStep: number}} options - Window options.
 * @returns {Promise<{resourceType: string, resourceName: string, zone: string}|null|{action: string}>}
 */
async function showZombieActionMenu(zombies, options) {
  const source = [];
  let idx = 1;
  //
  for (const d of zombies.unattachedDisks) {
    source.push({
      name: `${idx++}. [Disk] ${d.name} (${d.sizeGb} GB, ${d.zone})`,
      value: { resourceType: "disk", resourceName: d.name, zone: d.zone },
      search: `[disk] ${d.name}`.toLowerCase()
    });
  }
  for (const vm of zombies.stoppedVMs) {
    source.push({
      name: `${idx++}. [VM] ${vm.name} (${vm.machineType}, ${vm.zone})`,
      value: { resourceType: "vm", resourceName: vm.name, zone: vm.zone },
      search: `[vm] ${vm.name}`.toLowerCase()
    });
  }
  for (const s of zombies.orphanedSnapshots) {
    source.push({
      name: `${idx++}. [Snapshot] ${s.name} (from ${s.sourceDisk})`,
      value: { resourceType: "snapshot", resourceName: s.name, zone: "" },
      search: `[snapshot] ${s.name}`.toLowerCase()
    });
  }
  for (const a of zombies.unusedIPs) {
    source.push({
      name: `${idx++}. [IP] ${a.address} (${a.name}, ${a.region})`,
      value: { resourceType: "ip", resourceName: a.name, zone: a.region },
      search: `[ip] ${a.name}`.toLowerCase()
    });
  }
  //
  if (source.length === 0) {
    return { action: "back" };
  }
  //
  const { selected } = await inquirer.prompt([{
    type: "filterableList",
    name: "selected",
    message: "Select resource to mark as exception (type to filter, \u2190 back, ESC to exit):",
    source,
    pageWindow: options.maxItems,
    pageStep: options.pageStep,
    enableBack: true,
    formatLoadMore: ui.formatLoadMore,
    noMatchesText: ui.formatNoMatches
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
 * Shows the global disks as a filterable, columnar list.
 * Selecting a row simply returns to the inventory menu.
 * @param {Array} disks - All disks.
 * @param {Compute} computeInstance - Compute instance for helper methods.
 * @param {{maxItems: number, pageStep: number}} options - Window options.
 * @returns {Promise<string|null|{action: string}>} Selection result.
 */
async function showDiskInventory(disks, computeInstance, options) {
  const source = disks.map((d) => {
    const attached = computeInstance.extractAttachedVMName(d.users);
    const statusDisplay = d.users.length > 0 ? "attached" : "unattached";
    return {
      name: ui.formatColumns(
        [d.name, `${d.sizeGb} GB`, d.type, formatStatusColor(statusDisplay), attached],
        [32, 8, 14, 10, 20]
      ),
      value: d.name,
      search: d.name.toLowerCase()
    };
  });
  //
  const { selected } = await inquirer.prompt([{
    type: "filterableList",
    name: "selected",
    message: "Persistent Disks (type to filter, \u2190 back, ESC to exit):",
    source,
    pageWindow: options.maxItems,
    pageStep: options.pageStep,
    enableBack: true,
    formatLoadMore: ui.formatLoadMore,
    noMatchesText: ui.formatNoMatches
  }]);
  //
  return selected;
}
//
/**
 * Shows the global addresses as a filterable, columnar list.
 * Selecting a row simply returns to the inventory menu.
 * @param {Array} addresses - All addresses.
 * @param {Compute} computeInstance - Compute instance for helper methods.
 * @param {{maxItems: number, pageStep: number}} options - Window options.
 * @returns {Promise<string|null|{action: string}>} Selection result.
 */
async function showAddressInventory(addresses, computeInstance, options) {
  const source = addresses.map((a) => {
    const usedBy = computeInstance.extractUserName(a.users);
    return {
      name: ui.formatColumns(
        [a.address, a.name, a.region, a.addressType, formatStatusColor(a.status), usedBy],
        [16, 26, 14, 10, 10, 20]
      ),
      value: a.name,
      search: a.name.toLowerCase()
    };
  });
  //
  const { selected } = await inquirer.prompt([{
    type: "filterableList",
    name: "selected",
    message: "Static IP Addresses (type to filter, \u2190 back, ESC to exit):",
    source,
    pageWindow: options.maxItems,
    pageStep: options.pageStep,
    enableBack: true,
    formatLoadMore: ui.formatLoadMore,
    noMatchesText: ui.formatNoMatches
  }]);
  //
  return selected;
}
//
/**
 * Shows the global snapshots as a filterable, columnar list.
 * Selecting a row simply returns to the inventory menu.
 * @param {Array} snapshots - All snapshots.
 * @param {{maxItems: number, pageStep: number}} options - Window options.
 * @returns {Promise<string|null|{action: string}>} Selection result.
 */
async function showSnapshotInventory(snapshots, options) {
  const source = snapshots.map((s) => ({
    name: ui.formatColumns(
      [s.name, ui.formatDate(s.creationTimestamp), `${s.diskSizeGb} GB`, s.sourceDisk || "-", formatStatusColor(s.status)],
      [32, 13, 8, 24, 10]
    ),
    value: s.name,
    search: s.name.toLowerCase()
  }));
  //
  const { selected } = await inquirer.prompt([{
    type: "filterableList",
    name: "selected",
    message: "Snapshots (type to filter, \u2190 back, ESC to exit):",
    source,
    pageWindow: options.maxItems,
    pageStep: options.pageStep,
    enableBack: true,
    formatLoadMore: ui.formatLoadMore,
    noMatchesText: ui.formatNoMatches
  }]);
  //
  return selected;
}
//
/**
 * Prints a truncation note when a report section exceeds maxItems.
 * @param {number} total - Total rows in the section.
 * @param {number} maxItems - Max rows shown.
 */
function showSectionTruncation(total, maxItems) {
  if (total > maxItems) {
    ui.showWarning(`(showing first ${maxItems} of ${total}; the full set is in the selection list below)`);
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
    showSectionTruncation(zombies.unattachedDisks.length, maxItems);
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
    showSectionTruncation(zombies.stoppedVMs.length, maxItems);
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
    showSectionTruncation(zombies.orphanedSnapshots.length, maxItems);
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
    showSectionTruncation(zombies.unusedIPs.length, maxItems);
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
    const pageStep = settings.janitor.pageStep;
    const thresholdDays = settings.janitor.stoppedVmThresholdDays;
    const listOptions = { maxItems, pageStep };
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
              if (cachedInstances.length === 0) {
                ui.showWarning("No VM instances found.");
                break;
              }
              //
              const { selected: vmChoice, filterTerm } = await showVMList(cachedInstances, listOptions);
              //
              if (vmChoice === null) {
                return; // ESC.
              }
              if (vmChoice?.action === "back") {
                break; // Back to inventory menu.
              }
              //
              // Export to CSV: replay the live filter on the full set, so the
              // export matches exactly what the user was seeing.
              if (vmChoice === "__export_csv__") {
                const term = filterTerm.toLowerCase();
                const filtered = cachedInstances.filter(i =>
                  !term || i.name.toLowerCase().includes(term)
                );
                if (filtered.length === 0) {
                  ui.showWarning("No VM instances match the current filter; nothing to export.");
                  continue;
                }
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
            // Flat disks view: any row selection returns to the inventory menu.
            if (cachedDisks.length === 0) {
              ui.showInfo("No disks found.");
            } else if (await showDiskInventory(cachedDisks, computeInstance, listOptions) === null) {
              return; // ESC.
            }
          } else if (inventoryChoice === "snapshots") {
            // Flat snapshots view: any row selection returns to the inventory menu.
            if (cachedSnapshots.length === 0) {
              ui.showInfo("No snapshots found.");
            } else if (await showSnapshotInventory(cachedSnapshots, listOptions) === null) {
              return; // ESC.
            }
          } else if (inventoryChoice === "ips") {
            // Flat IPs view: any row selection returns to the inventory menu.
            if (cachedAddresses.length === 0) {
              ui.showInfo("No static IP addresses found.");
            } else if (await showAddressInventory(cachedAddresses, computeInstance, listOptions) === null) {
              return; // ESC.
            }
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
            const actionChoice = await showZombieActionMenu(zombies, listOptions);
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
