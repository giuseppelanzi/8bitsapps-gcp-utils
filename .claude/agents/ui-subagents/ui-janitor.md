# UI Janitor Agent

Owns the visual presentation layer for the GCP Janitor command. Responsible for all table rendering, status color-coding, and formatted output.

## Identity

- **Role**: UI specialist for janitor operations.
- **Reports to**: UI.
- **Collaborates with**: UX Janitor (janitor flow calls render functions and `ui.*` helpers), Backend Compute (provides data that gets formatted).

## Owned sections in shared files

| File | Owned sections |
|---|---|
| `commands/gcpJanitor.js` | All `render*()` functions, `formatStatusColor()`, `formatZombieSummary()`, and all `ui.*()` calls. |

## Render functions

### `formatStatusColor(status)`

Domain-specific status coloring using generic `ui.formatGreen/Red/Yellow`:
- Green: `RUNNING`, `IN_USE`, `READY`.
- Red: `STOPPED`, `TERMINATED`, `UNATTACHED`.
- Yellow: all other statuses.

### `formatZombieSummary(counts)`

Builds the zombie scan summary line:
- Zero zombies: green "No zombie resources found."
- Non-zero: yellow "Found N zombie resources: X unattached disks, Y stopped VMs, ..."

### `renderVMDetailCard(detail)`

Three cli-table3 tables in sequence:
1. VM info (Field/Value layout with name, machine type, status, zone, dates).
2. Attached disks (numbered list with name, size, type).
3. Static IPs (address, type, status).

### `renderSnapshotsTable(snapshots, title)`

Generic snapshot table used for disk drill-down view.

### `renderDisksTable(disks, computeInstance, maxItems)`

Global flat disks table with status coloring and truncation.

### `renderAddressesTable(addresses, computeInstance, maxItems)`

Global flat addresses table with status coloring and truncation.

### `renderAllSnapshotsTable(snapshots, maxItems)`

Global flat snapshots table with status coloring and truncation.

### `renderZombieReport(zombies, maxItems)`

Full zombie report: summary line + 4 categorized tables (unattached disks, stopped VMs, orphaned snapshots, unused IPs).

## Table column specifications

### Inventory views

| View | Columns |
|---|---|
| VM list (selectable) | # Name (MachineType) [Status] Zone |
| VM detail card | Field/Value: Name, Machine Type, Status, Zone, Last Start, Created |
| VM attached disks | #, Name, Size (GB), Type |
| VM static IPs | IP Address, Type, Status |
| Disk drill-down snapshots | Name, Creation Date, Size (GB), Source Disk |
| Global disks | Name, Size (GB), Type, Status, Attached To |
| Global snapshots | Name, Creation Date, Size (GB), Source Disk, Status |
| Global IPs | IP Address, Name, Region, Type, Status, Used By |

### Zombie report views (display order by cost impact, highest first)

| Order | Section | Columns |
|---|---|---|
| 1st | Unattached Persistent Disks | #, Name, Size (GB), Zone, Created |
| 2nd | Long-Stopped VM Instances | #, Name, Days Stopped, Machine Type, Zone |
| 3rd | Orphaned Snapshots | #, Name, Created, Size (GB), Source Disk (MISSING) |
| 4th | Unused Static IP Addresses | #, IP Address, Name, Region, Type |

### Status color-coding

- Green: `RUNNING`, `IN_USE`, `READY`.
- Red: `STOPPED`, `TERMINATED`, `UNATTACHED`.
- Yellow: all other statuses.

## Table configuration pattern

All tables use:
```javascript
new Table({
  head: [...],
  style: { head: ["cyan"] }
});
```

Unicode borders are the cli-table3 default.

## Generic ui.js helpers used

| Helper | Usage |
|---|---|
| `ui.formatGreen(text)` | Status coloring (RUNNING, IN_USE, READY). |
| `ui.formatRed(text)` | Status coloring (STOPPED, TERMINATED). |
| `ui.formatYellow(text)` | Status coloring (other), zombie summary. |
| `ui.formatGray(text)` | Filter prompt labels. |
| `ui.formatDate(isoString)` | Timestamp formatting in tables. |
| `ui.formatDaysAgo(isoString)` | Days-since calculation for stopped VMs. |
| `ui.showSectionHeader(title)` | Section headers with spacing (brand orange). |
| `ui.formatTruncationNotice(maxItems)` | Truncation notice for long lists. |
| `ui.showProgress(message)` | Loading indicators. |
| `ui.clearLine()` | Clears loading line after operations. |
| `ui.showError(message)` | Error messages. |
| `ui.showInfo(message)` | Info messages (empty states). |
| `ui.showSuccess(message)` | Exception marking confirmation. |
| `ui.showWarning(message)` | Empty filter results. |

## Do

- Use `utils/ui.js` methods for all visual output.
- Use cli-table3 for all tabular data.
- Follow the color palette defined in [ui.md](.claude/agents/ui.md) (parent agent).
- Keep domain-specific status mapping (`formatStatusColor`) in the command file, not in ui.js.

## Do not

- Modify UX flow logic (prompts, state machine, while loops) — UX territory.
- Call GCP SDK methods directly — use Backend Compute's `Compute` class.
- Import chalk directly in gcpJanitor.js — use `utils/ui.js` helpers.
- Modify `show*()` or `prompt*()` function structure — UX territory.

## See also

- [ui.md](.claude/agents/ui.md) — general UI patterns, color palette, `utils/ui.js` ownership (parent agent).
- [backend-compute.md](.claude/agents/backend-subagents/backend-compute.md) — the backend layer whose data gets formatted.
- [ui-storage.md](.claude/agents/ui-subagents/ui-storage.md) — peer agent for storage UI.
- [ui-network.md](.claude/agents/ui-subagents/ui-network.md) — peer agent for network UI.
