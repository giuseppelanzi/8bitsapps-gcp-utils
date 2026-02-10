# GCP Janitor (Resource Analyzer)

## Overview

The GCP Janitor is a main command of the program designed to act as a "janitor" and resource analysis tool for Google Cloud Platform. It helps users identify unnecessary costs and inactive or orphaned resources ("zombie items") that can be eliminated to optimize spending.

The tool performs a comprehensive or targeted scan (global or hierarchical) of Compute Engine resources to create a detailed inventory and highlight waste.

## Resources

### VM Instances (Servers)

| Field | Description |
|---|---|
| Name | Instance name. |
| Machine type | Short machine type (e.g. `e2-medium`, `n1-standard-4`). |
| vCPUs | Number of virtual CPUs. |
| Memory | RAM in GB. |
| Status | Current status: `RUNNING`, `STOPPED`, `TERMINATED`, etc. |
| Last start | Timestamp of the last known startup. |
| Zone | Zone where the instance runs (e.g. `us-central1-a`). |

### Persistent Disks

| Field | Description |
|---|---|
| Name | Disk name. |
| Size | Disk size in GB. |
| Type | Disk type: `pd-standard`, `pd-ssd`, `pd-balanced`, etc. |
| Status | Attached or unattached. |
| Attached to | VM instance using this disk, or "unattached". |

### Snapshots

| Field | Description |
|---|---|
| Name | Snapshot name. |
| Creation date | When the snapshot was created. |
| Size | Storage consumed by the snapshot. |
| Source disk | Name of the disk this snapshot was taken from (if still available). |

### Static IP Addresses

| Field | Description |
|---|---|
| IP address | The actual IP address. |
| Scope | External or internal. |
| Status | `IN_USE` or `RESERVED`. |
| Used by | VM, load balancer, or other resource using this address, or "unused". |

## Interactive flow

The GCP Janitor is accessible as a main command within the gcpUtils tool.

| Step | User action | Description |
|---|---|---|
| 1 | Run `gcpUtils` | The tool starts and shows the main menu. |
| 2 | Select a configuration | The user selects a project configuration (e.g. `gcp-options-myproject.json`). |
| 3 | Select "GCP Janitor" | The Janitor main menu loads. |

### Janitor main menu

| Option | Goal | Priority |
|---|---|---|
| A. Resource Inventory (Detail) | Hierarchical or global exploration for a complete inventory of all resources. | 1st (Detailed analysis) |
| B. Zombie Items & Cleanup | Quick identification of inactive or orphaned resources. | 2nd (Cost impact) |
| C. Exit / Back to main menu | Exit the Janitor and return to gcpUtils main menu. | — |

## Resource Inventory (Option A)

When the user selects **A. Resource Inventory (Detail)**, the navigator presents resource categories.

### Inventory menu

| Option | Resource | View mode | Initial columns |
|---|---|---|---|
| A.1 | VM Instances (Servers) | Hierarchical, with name filter | Name, Type, CPU/RAM, Status, Zone. |
| A.2 | Persistent Disks (Global) | Global flat list, with name filter | Name, Size, Status, Attached VM. |
| A.3 | Snapshots (Global) | Global flat list, with name filter | Name, Creation Date, Size, Source Disk. |
| A.4 | Static IP Addresses (Global) | Global flat list, with name filter | IP Address, Scope, Attached Resource (VM/LB/other). |

ESC goes back to the Janitor main menu.

### Mode 1: Hierarchical exploration (VM detail)

The user selects **A.1 VM Instances**. The list supports a **name filter**: the user can type to filter VMs by name substring match, narrowing the list before selecting. After filtering (or immediately), the user selects a specific VM.

A detail card is shown for the selected VM containing, in sequence:

1. **VM data**: name, machine type, vCPUs, memory, status, zone, last start.
2. **Attached disks**: list of disks attached to this specific VM (name, size, type).
3. **Static IPs**: list of static IP addresses assigned to this VM's network interfaces.

From the disk list, the user can **select a disk to drill down** into its snapshots. This shows all snapshots taken from that specific disk (name, creation date, size).

Navigation:
- Left arrow (←) goes back one level.
- ESC exits to the inventory menu.
- Loading indicator shown while fetching/filtering data.

If the VM has no disks, the disks section shows "No disks attached." If a disk has no snapshots, the snapshot level shows "No snapshots found."

### Mode 2: Global exploration (flat lists)

Accessible by selecting **A.2**, **A.3**, or **A.4** from the inventory menu. Each shows a complete list of all resources of the selected type in the project, displayed as a formatted table using `cli-table3` with unicode borders.

All global lists support a **name filter** option: a text input prompt where the user can type a substring to filter the displayed resources by name. The filter is applied before rendering the table, narrowing results to matching entries only. Leaving the filter empty shows all resources.

Tables respect the `maxItems` setting. When the total exceeds the limit, a truncation message is shown (e.g. "Showing first 50 of 200 items").

Status values are color-coded:
- Green: `RUNNING`, `IN_USE`, `READY`.
- Red: `STOPPED`, `TERMINATED`, unattached.
- Yellow: all other statuses.

After viewing a table, ESC returns to the inventory menu.

## Zombie Detection & Cleanup (Option B)

When the user selects **B. Zombie Items & Cleanup**, the tool scans all resources and identifies unused or orphaned items. Results are displayed in categorized sections, ordered by cost impact (highest first).

A summary line is printed at the top:

```
Found 7 zombie resources: 3 unattached disks, 2 stopped VMs, 1 orphaned snapshot, 1 unused IP.
```

If no zombies are found, a single green message is shown: "No zombie resources found."

Each section uses a `cli-table3` table. Resources previously marked as exceptions are excluded from the report.

### Zombie categories (in display order)

| Order | Zombie type | Key information | Available action |
|---|---|---|---|
| 1st | Unattached persistent disks | Name, Size, Creation Date. | Mark as exception. |
| 2nd | Long-stopped VM instances | Name, Days since last start/stop, Machine Type. | Mark as exception. |
| 3rd | Orphaned snapshots | Name, Creation Date, Source Disk (marked as MISSING). | Mark as exception. |
| 4th | Unused static IP addresses | IP Address, Region, Type (External/Internal). | Mark as exception. |

Future versions will add destructive actions (delete, start, release) with confirmation prompts.

## Zombie detection rules

### Unattached persistent disks (medium cost impact)

A disk is flagged as zombie when:
- its `users` array is empty (no VM instance references it).

### Long-stopped VM instances (high cost impact)

An instance is flagged as zombie when:
- `status` is `STOPPED`, AND
- it has been stopped for more than `stoppedVmThresholdDays` (default: 30 days).

The "days stopped" is calculated as the number of days between now and the `lastStartTimestamp`. If `lastStartTimestamp` is missing, the `creationTimestamp` is used instead.

### Orphaned snapshots (low cost impact)

A snapshot is flagged as zombie when:
- its `sourceDisk` references a disk that no longer exists in the project.

Detection: the list of all current disk names/IDs is collected, and each snapshot's source disk is checked against it.

### Unused static IP addresses (low cost impact)

An address is flagged as zombie when:
- `status` is `RESERVED`, AND
- its `users` array is empty (not associated to any VM or load balancer).

## Exception system

When a user selects "Mark as exception" on a zombie item, the resource identifier is stored in a per-project exceptions file:

```
Configurations/janitor-exceptions-{configName}.json
```

This file follows the per-project pattern, allowing different exception lists for each GCP project configuration.

### Exception file format

```json
{
  "exceptions": [
    {
      "resourceType": "disk",
      "resourceName": "my-persistent-disk",
      "zone": "us-central1-a",
      "markedAt": "2026-01-15T10:30:00Z",
      "reason": ""
    }
  ]
}
```

When running zombie detection, resources matching an entry in the exceptions list are excluded from the report. The user can optionally provide a reason when marking an exception.

## Configuration

Settings are managed in `settings.json` (local or global, same as existing settings).

```json
{
  "storage": {
    "maxItems": 30
  },
  "janitor": {
    "maxItems": 50,
    "stoppedVmThresholdDays": 30
  }
}
```

| Setting | Default | Description |
|---|---|---|
| `janitor.maxItems` | 50 | Maximum number of rows shown in flat view tables and hierarchical lists. |
| `janitor.stoppedVmThresholdDays` | 30 | Days a VM must be stopped before being flagged as zombie. |

## Dependencies

| Package | Status | Usage |
|---|---|---|
| `@google-cloud/compute` | Already installed (v5.2.0) | InstancesClient, DisksClient, SnapshotsClient, AddressesClient. |
| `cli-table3` | **New** | Formatted tables with unicode borders for all list views. |
| `chalk` | Already installed | Status color-coding, loading indicators, section headers. |
| `inquirer` | Already installed | Interactive menus via `listWithEscape` prompt. |

## Required GCP roles

The service account used by the Janitor needs read access to Compute Engine resources. The following roles are sufficient:

| Role | Description |
|---|---|
| `roles/compute.viewer` | Read-only access to all Compute Engine resources (instances, disks, snapshots, addresses). Minimum required role. |

Alternatively, more granular predefined roles can be used:
- `roles/compute.instanceAdmin.v1` — if the user also needs to manage instances (future actions).
- `roles/compute.storageAdmin` — if the user also needs to manage disks and snapshots (future actions).

For the first version (read-only + mark as exception), `roles/compute.viewer` is sufficient.

## Architecture

### New files

| File | Owner | Description |
|---|---|---|
| `GCPUtilities/Compute.js` | Backend | Compute Engine class with methods to list instances, disks, snapshots, addresses; build hierarchical data; detect zombies. |
| `commands/gcpJanitor.js` | UX + UI | Command entry point with interactive menus (UX) and table formatting (UI). |

### Modified files

| File | Change |
|---|---|
| `GCPUtilities/index.js` | Export the new `Compute` class. |
| `commands/index.js` | Register the `gcpJanitor` command. |
| `utils/settings.js` | Add `janitor` defaults and merge logic. |

### Class structure

`Compute.js` follows the same lazy-loading pattern as `Network.js` and `Storage.js`:

```
Compute
├── constructor(configName)
├── loadConfiguration()        — lazy-loads config, credentials, 4 GCP clients.
├── unloadConfiguration()
├── listInstances()            — InstancesClient.aggregatedList()
├── listDisks()                — DisksClient.aggregatedList()
├── listSnapshots()            — SnapshotsClient.list() (global resource)
├── listAddresses()            — AddressesClient.aggregatedList()
├── getInstanceDetail(name)    — returns VM data + attached disks + assigned IPs.
├── getDiskSnapshots(diskName) — returns snapshots for a specific disk.
├── getHierarchicalData()      — fetches all, cross-references by disk.users and snapshot.sourceDisk.
└── findZombieResources(days)  — fetches all, applies zombie rules, returns categorized results.
```

### Command structure

`gcpJanitor.js` exports `{name, description, execute(configName)}` like all other commands. Internally it creates a `Compute` instance and runs a navigation loop with the Janitor menu and its sub-views.

### Exception management

Exception read/write is handled within the command file using simple `fs` operations on the per-project file `Configurations/janitor-exceptions-{configName}.json`. Utility functions:
- `loadExceptions(configName)` — reads and parses the exceptions file (returns empty array if missing).
- `saveExceptions(configName, exceptions)` — writes the exceptions array to file.
- `isException(exceptions, resourceType, resourceName)` — checks if a resource is marked as exception.
- `addException(configName, exceptions, resource)` — adds a resource to exceptions and saves.
