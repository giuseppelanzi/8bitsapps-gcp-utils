const compute = require("@google-cloud/compute");
const fs = require("fs/promises");
const { getConfigPath, getCredentialsPath } = require("../utils/paths.js");
//
// Suppress the AutopaginateTrueWarning emitted by @google-cloud/compute
// when using async paging methods (aggregatedListAsync, listAsync).
const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  if (typeof warning === "string" && warning.includes("Autopaginate")) return;
  if (warning?.name === "AutopaginateTrueWarning") return;
  return originalEmitWarning.call(process, warning, ...args);
};
//
/**
 * Compute Engine operations class.
 * Provides methods to list instances, disks, snapshots, and addresses.
 */
class Compute {
  constructor(configName) {
    this.configurationName = configName;
    this.configuration = null;
    this.credentials = null;
    this.instancesClient = null;
    this.disksClient = null;
    this.snapshotsClient = null;
    this.addressesClient = null;
  }
  //
  /**
   * Lazy-loads configuration, credentials, and SDK clients.
   * @returns {Promise<void>}
   */
  async loadConfiguration() {
    if (this.configuration) {
      return; // Already loaded.
    }
    if (!this.configurationName)
      throw new Error("Missing configuration name.");
    //
    const configFileName = getConfigPath(this.configurationName);
    this.configuration = JSON.parse(await fs.readFile(configFileName, "utf8"));
    //
    const credentialsFileName = getCredentialsPath(this.configuration.credentialsFile);
    this.credentials = JSON.parse(await fs.readFile(credentialsFileName, "utf8"));
    //
    const clientOptions = {
      credentials: this.credentials,
      projectId: this.configuration.defaultProjectId
    };
    this.instancesClient = new compute.InstancesClient(clientOptions);
    this.disksClient = new compute.DisksClient(clientOptions);
    this.snapshotsClient = new compute.SnapshotsClient(clientOptions);
    this.addressesClient = new compute.AddressesClient(clientOptions);
  }
  //
  /**
   * Releases configuration, credentials, and SDK clients.
   */
  unloadConfiguration() {
    this.configuration = null;
    this.credentials = null;
    this.instancesClient = null;
    this.disksClient = null;
    this.snapshotsClient = null;
    this.addressesClient = null;
  }
  //
  /**
   * Lists all VM instances in the project.
   * @returns {Promise<Array<{name: string, machineType: string, status: string, zone: string, lastStart: string, creationTimestamp: string, disks: Array<{source: string, deviceName: string}>, networkInterfaces: Array}>>}
   */
  async listInstances() {
    await this.loadConfiguration();
    //
    const projectId = this.configuration.defaultProjectId;
    const instances = [];
    //
    const iterable = this.instancesClient.aggregatedListAsync({
      project: projectId
    });
    //
    for await (const [zonePath, scopedList] of iterable) {
      if (!scopedList.instances || scopedList.instances.length === 0) {
        continue;
      }
      //
      const zone = zonePath.split("/").pop();
      for (const instance of scopedList.instances) {
        const machineTypeParts = (instance.machineType || "").split("/");
        const machineTypeShort = machineTypeParts[machineTypeParts.length - 1];
        //
        instances.push({
          name: instance.name,
          machineType: machineTypeShort,
          status: instance.status,
          zone: zone,
          lastStart: instance.lastStartTimestamp || "",
          creationTimestamp: instance.creationTimestamp || "",
          disks: (instance.disks || []).map(d => ({
            source: d.source || "",
            deviceName: d.deviceName || ""
          })),
          networkInterfaces: instance.networkInterfaces || []
        });
      }
    }
    //
    return instances;
  }
  //
  /**
   * Lists all persistent disks in the project.
   * @returns {Promise<Array<{name: string, sizeGb: string, type: string, status: string, zone: string, users: string[], creationTimestamp: string}>>}
   */
  async listDisks() {
    await this.loadConfiguration();
    //
    const projectId = this.configuration.defaultProjectId;
    const disks = [];
    //
    const iterable = this.disksClient.aggregatedListAsync({
      project: projectId
    });
    //
    for await (const [zonePath, scopedList] of iterable) {
      if (!scopedList.disks || scopedList.disks.length === 0) {
        continue;
      }
      //
      const zone = zonePath.split("/").pop();
      for (const disk of scopedList.disks) {
        const typeParts = (disk.type || "").split("/");
        const typeShort = typeParts[typeParts.length - 1];
        //
        disks.push({
          name: disk.name,
          sizeGb: disk.sizeGb || "0",
          type: typeShort,
          status: disk.status,
          zone: zone,
          users: disk.users || [],
          creationTimestamp: disk.creationTimestamp || ""
        });
      }
    }
    //
    return disks;
  }
  //
  /**
   * Lists all snapshots in the project.
   * @returns {Promise<Array<{name: string, creationTimestamp: string, diskSizeGb: string, storageBytes: string, sourceDisk: string, sourceDiskFull: string, status: string}>>}
   */
  async listSnapshots() {
    await this.loadConfiguration();
    //
    const projectId = this.configuration.defaultProjectId;
    const snapshots = [];
    //
    const iterable = this.snapshotsClient.listAsync({
      project: projectId
    });
    //
    for await (const snapshot of iterable) {
      const sourceDiskParts = (snapshot.sourceDisk || "").split("/");
      const sourceDiskName = sourceDiskParts[sourceDiskParts.length - 1] || "";
      //
      snapshots.push({
        name: snapshot.name,
        creationTimestamp: snapshot.creationTimestamp || "",
        diskSizeGb: snapshot.diskSizeGb || "0",
        storageBytes: snapshot.storageBytes || "0",
        sourceDisk: sourceDiskName,
        sourceDiskFull: snapshot.sourceDisk || "",
        status: snapshot.status || ""
      });
    }
    //
    return snapshots;
  }
  //
  /**
   * Lists all static IP addresses in the project.
   * @returns {Promise<Array<{address: string, name: string, region: string, addressType: string, status: string, users: string[]}>>}
   */
  async listAddresses() {
    await this.loadConfiguration();
    //
    const projectId = this.configuration.defaultProjectId;
    const addresses = [];
    //
    const iterable = this.addressesClient.aggregatedListAsync({
      project: projectId
    });
    //
    for await (const [regionPath, scopedList] of iterable) {
      if (!scopedList.addresses || scopedList.addresses.length === 0) {
        continue;
      }
      //
      const region = regionPath.split("/").pop();
      for (const addr of scopedList.addresses) {
        addresses.push({
          address: addr.address || "",
          name: addr.name,
          region: region,
          addressType: addr.addressType || "",
          status: addr.status || "",
          users: addr.users || []
        });
      }
    }
    //
    return addresses;
  }
  //
  /**
   * Builds detail card data for a specific VM instance.
   * Pure data method — no API calls, operates on pre-fetched arrays.
   * @param {Array} instances - All instances from listInstances().
   * @param {Array} disks - All disks from listDisks().
   * @param {Array} snapshots - All snapshots from listSnapshots().
   * @param {Array} addresses - All addresses from listAddresses().
   * @param {string} instanceName - The VM name to look up.
   * @returns {{instance: object, attachedDisks: Array, assignedIPs: Array}|null}
   */
  getInstanceDetail(instances, disks, snapshots, addresses, instanceName) {
    const instance = instances.find(i => i.name === instanceName);
    if (!instance) {
      return null;
    }
    //
    // Find attached disks by matching disk source URLs to disk names.
    const attachedDiskNames = instance.disks.map(d => {
      const parts = d.source.split("/");
      return parts[parts.length - 1];
    });
    const attachedDisks = disks.filter(d => attachedDiskNames.includes(d.name));
    //
    // Find static IPs assigned to this instance via network interfaces.
    const instanceSelfLinkSuffix = `instances/${instance.name}`;
    const assignedIPs = addresses.filter(a =>
      a.users.some(u => u.includes(instanceSelfLinkSuffix))
    );
    //
    return { instance, attachedDisks, assignedIPs };
  }
  //
  /**
   * Filters snapshots for a specific source disk.
   * Pure data method — no API calls.
   * @param {Array} snapshots - All snapshots from listSnapshots().
   * @param {string} diskName - The disk name to filter by.
   * @returns {Array} Snapshots from the specified disk.
   */
  getDiskSnapshots(snapshots, diskName) {
    return snapshots.filter(s => s.sourceDisk === diskName);
  }
  //
  /**
   * Detects zombie resources from pre-fetched data.
   * Pure data method — no API calls.
   * @param {Array} instances - All instances.
   * @param {Array} disks - All disks.
   * @param {Array} snapshots - All snapshots.
   * @param {Array} addresses - All addresses.
   * @param {number} thresholdDays - Days threshold for stopped VMs.
   * @returns {{unattachedDisks: Array, stoppedVMs: Array, orphanedSnapshots: Array, unusedIPs: Array}}
   */
  findZombieResources(instances, disks, snapshots, addresses, thresholdDays) {
    const now = Date.now();
    const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
    //
    // 1. Unattached disks: users array is empty.
    const unattachedDisks = disks.filter(d => d.users.length === 0);
    //
    // 2. Long-stopped VMs: status STOPPED + older than threshold.
    const stoppedVMs = instances.filter(i => {
      if (i.status !== "STOPPED") return false;
      const lastActive = i.lastStart || i.creationTimestamp;
      if (!lastActive) return true;
      const elapsed = now - new Date(lastActive).getTime();
      return elapsed > thresholdMs;
    });
    //
    // 3. Orphaned snapshots: source disk no longer exists.
    const allDiskNames = new Set(disks.map(d => d.name));
    const orphanedSnapshots = snapshots.filter(s =>
      s.sourceDisk && !allDiskNames.has(s.sourceDisk)
    );
    //
    // 4. Unused static IPs: status RESERVED + users array empty.
    const unusedIPs = addresses.filter(a =>
      a.status === "RESERVED" && a.users.length === 0
    );
    //
    return { unattachedDisks, stoppedVMs, orphanedSnapshots, unusedIPs };
  }
  //
  /**
   * Extracts the VM name from a disk users array.
   * @param {string[]} users - Array of resource URLs using this disk.
   * @returns {string} VM name or "unattached".
   */
  extractAttachedVMName(users) {
    if (!users || users.length === 0) {
      return "unattached";
    }
    const parts = users[0].split("/");
    return parts[parts.length - 1];
  }
  //
  /**
   * Extracts the resource name from an address users array.
   * @param {string[]} users - Array of resource URLs using this address.
   * @returns {string} Resource name or "unused".
   */
  extractUserName(users) {
    if (!users || users.length === 0) {
      return "unused";
    }
    const parts = users[0].split("/");
    return parts[parts.length - 1];
  }
}
//
module.exports = Compute;
