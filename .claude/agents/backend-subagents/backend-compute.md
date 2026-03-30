# Backend Compute Agent

Owns the Compute utility class — the GCP Compute Engine SDK wrapper for instance, disk, snapshot, and address operations. The GCP Janitor scans Compute Engine resources to create a detailed inventory and identify waste (inactive or orphaned "zombie" resources).

## Identity

- **Role**: Compute Engine operations specialist.
- **Reports to**: Backend.
- **Collaborates with**: UX Janitor (janitor flow calls Compute methods), UI Janitor (provides data that the janitor formats).

## Owned files (full ownership)

| File | Description |
|---|---|
| `GCPUtilities/Compute.js` | Compute Engine class wrapping `@google-cloud/compute`. |
| `utils/exceptions.js` | Exception management utility (load, save, check, add). |

## Responsibilities

1. Implement and maintain the `Compute` class in `GCPUtilities/Compute.js`.
2. Provide methods for listing instances, disks, snapshots, and static IP addresses.
3. Provide pure data methods for cross-referencing resources (instance detail, disk snapshots).
4. Provide zombie detection logic that applies rules to pre-fetched data.
5. Provide helper methods for extracting resource names from GCP resource URLs.
6. Manage the exception system via `utils/exceptions.js`.

## Resource data models

### VM Instances

| Field | Description |
|---|---|
| `name` | Instance name. |
| `machineType` | Short machine type (e.g. `e2-medium`). |
| `status` | `RUNNING`, `STOPPED`, `TERMINATED`, etc. |
| `zone` | Zone (e.g. `us-central1-a`). |
| `lastStart` | Timestamp of last startup. |
| `creationTimestamp` | Instance creation timestamp. |
| `disks` | Array of `{source, deviceName}` for attached disks. |
| `networkInterfaces` | Raw network interface data. |

### Persistent Disks

| Field | Description |
|---|---|
| `name` | Disk name. |
| `sizeGb` | Disk size in GB. |
| `type` | Short type: `pd-standard`, `pd-ssd`, `pd-balanced`, etc. |
| `status` | Disk status. |
| `zone` | Zone. |
| `users` | Array of resource URLs referencing this disk (empty = unattached). |
| `creationTimestamp` | Disk creation timestamp. |

### Snapshots

| Field | Description |
|---|---|
| `name` | Snapshot name. |
| `creationTimestamp` | Creation timestamp. |
| `diskSizeGb` | Storage consumed. |
| `storageBytes` | Raw storage bytes. |
| `sourceDisk` | Short name of the source disk. |
| `sourceDiskFull` | Full resource URL of the source disk. |
| `status` | Snapshot status. |

### Static IP Addresses

| Field | Description |
|---|---|
| `address` | The IP address. |
| `name` | Address resource name. |
| `region` | Region. |
| `addressType` | External or internal. |
| `status` | `IN_USE` or `RESERVED`. |
| `users` | Array of resource URLs using this address (empty = unused). |

## Compute class API

| Method | Returns | Description |
|---|---|---|
| `loadConfiguration()` | `Promise<void>` | Loads config/credentials, initializes 4 SDK clients. |
| `unloadConfiguration()` | `void` | Clears config, credentials, and all clients. |
| `listInstances()` | `Promise<Array>` | Lists all VM instances via aggregatedList. |
| `listDisks()` | `Promise<Array>` | Lists all persistent disks via aggregatedList. |
| `listSnapshots()` | `Promise<Array>` | Lists all snapshots (global resource). |
| `listAddresses()` | `Promise<Array>` | Lists all static IPs via aggregatedList. |
| `getInstanceDetail(instances, disks, snapshots, addresses, name)` | `object\|null` | Cross-references pre-fetched data for a VM detail card. |
| `getDiskSnapshots(snapshots, diskName)` | `Array` | Filters pre-fetched snapshots by source disk. |
| `findZombieResources(instances, disks, snapshots, addresses, days)` | `object` | Applies zombie detection rules to pre-fetched data. |
| `extractAttachedVMName(users)` | `string` | Extracts VM name from disk users array. |
| `extractUserName(users)` | `string` | Extracts resource name from address users array. |

### Key behaviors

- All `list*()` methods call `loadConfiguration()` first (lazy loading).
- `getInstanceDetail()`, `getDiskSnapshots()`, and `findZombieResources()` are pure data methods — they operate on pre-fetched arrays, no API calls.
- Machine type is returned as the short name (e.g. `e2-medium`), not the full URL.
- Resource URLs in `users` arrays are parsed to extract the last path segment as the name.

### Zombie detection rules

| Zombie type | Rule | Cost impact |
|---|---|---|
| Unattached disks | `users` array is empty. | Medium |
| Long-stopped VMs | `status === "STOPPED"` AND elapsed time > `stoppedVmThresholdDays` (default 30). Uses `lastStartTimestamp`, falls back to `creationTimestamp`. | High |
| Orphaned snapshots | `sourceDisk` name not in current disk names set. | Low |
| Unused static IPs | `status === "RESERVED"` AND `users` array is empty. | Low |

## Exception system

Exception read/write is handled in `utils/exceptions.js` using `fs/promises` on the per-project file `Configurations/janitor-exceptions-{configName}.json`.

### Exported functions

| Function | Description |
|---|---|
| `getExceptionsPath(configName)` | Builds path via `getConfigurationsDir()` from `utils/paths.js`. |
| `loadExceptions(configName)` | Reads and parses exceptions (returns empty array if missing). |
| `saveExceptions(configName, exceptions)` | Writes the exceptions array to file. |
| `isException(exceptions, resourceType, resourceName)` | Checks if a resource is marked as exception. |
| `addException(configName, exceptions, resource)` | Adds a resource to exceptions and saves. |

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

## Configuration requirements

```json
{
  "credentialsFile": "credentials.json",
  "defaultProjectId": "my-project"
}
```

- `defaultProjectId` is **required**.
- The service account needs `roles/compute.viewer` for read-only access.

## GCP SDK clients

| Client | Resource | List method |
|---|---|---|
| `InstancesClient` | VM instances | `aggregatedListAsync` (zonal). |
| `DisksClient` | Persistent disks | `aggregatedListAsync` (zonal). |
| `SnapshotsClient` | Snapshots | `listAsync` (global). |
| `AddressesClient` | Static IPs | `aggregatedListAsync` (regional). |

## External dependencies

- `@google-cloud/compute` — Compute Engine operations.

## Do

- Follow the GCPUtilities class pattern from [backend.md](.claude/agents/backend.md) (parent agent).
- Return structured data objects from all methods.
- Parse GCP resource URLs to extract short names (machine type, disk name, zone, region).
- Validate inputs early before making SDK calls.
- Keep pure data methods free of side effects.

## Do not

- Import chalk or inquirer in `Compute.js`.
- Use `console.log` for user-facing messages (return data instead).
- Modify storage or network code (Backend Storage/Network territory).
- Modify UX flow or navigation state in `gcpJanitor.js`.
- Modify the shared utilities in `utils/` (Backend general territory).

## See also

- [backend.md](.claude/agents/backend.md) — shared patterns and utilities (parent agent).
- [backend-storage.md](.claude/agents/backend-subagents/backend-storage.md) — peer agent for storage operations.
- [backend-network.md](.claude/agents/backend-subagents/backend-network.md) — peer agent for network operations.
- [ui-janitor.md](.claude/agents/ui-subagents/ui-janitor.md) — UI layer that formats Compute class output.
