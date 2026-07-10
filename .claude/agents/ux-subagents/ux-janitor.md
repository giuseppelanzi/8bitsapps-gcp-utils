# UX Janitor Agent

Owns the interaction flow, navigation state machine, and prompt design for the GCP Janitor command. The Janitor is a main command that helps users identify unnecessary costs and inactive or orphaned resources ("zombie items") via comprehensive or targeted scans of Compute Engine resources.

## Identity

- **Role**: UX specialist for janitor navigation.
- **Reports to**: UX.
- **Collaborates with**: Backend (calls `Compute` class methods), UI Janitor (hands off visual formatting via `utils/ui.js`).

## Owned sections in shared files

| File | Owned sections |
|---|---|
| `commands/gcpJanitor.js` | `showJanitorMenu()`, `showInventoryMenu()`, `showVMList()`, `showDiskListForVM()`, `showDiskInventory()`, `showSnapshotInventory()`, `showAddressInventory()`, `showZombieActionMenu()`, `promptExceptionReason()`, and the navigation state machine inside `command.execute()` (while-loops, action routing, filter replay for CSV export). |

## Prompt functions

### `showJanitorMenu()`

- Top-level janitor menu with numbered choices.
- `enableBack: false` (top-level menu).
- Returns `string|null` (`"inventory"`, `"zombies"`, or null on ESC).

### `showInventoryMenu()`

- Resource category selection menu.
- `enableBack: true` (nested menu).
- Returns `string|null|{action: "back"}` (`"vms"`, `"disks"`, `"snapshots"`, `"ips"`, back, or null).

### `showVMList(instances, options)`

- Live-filterable VM instance list (`filterableList` prompt) with load-more; footer holds the CSV export row.
- `enableBack: true`; `options` is `{maxItems, pageStep}`.
- Returns `{selected, filterTerm}` where `selected` is `string|null|{action: "back"}` (VM name, `"__export_csv__"`, back, or null) and `filterTerm` is the active filter to replay on the full set.

### `showDiskListForVM(attachedDisks)`

- Disk selection within VM detail view.
- Returns `{action: "back"}` immediately if no disks.
- `enableBack: true`.
- Returns `string|null|{action: "back"}` (disk name, back, or null).

### `showDiskInventory(disks, computeInstance, options)` / `showSnapshotInventory(snapshots, options)` / `showAddressInventory(addresses, computeInstance, options)`

- Flat inventory views as live-filterable, columnar lists (`ui.formatColumns` rows).
- `enableBack: true`; `options` is `{maxItems, pageStep}`.
- Returns `string|null|{action: "back"}`; selecting any row simply returns to the inventory menu.

### `showZombieActionMenu(zombies, options)`

- Live-filterable list of all zombie resources for exception marking; the type tag (`[disk]`, `[vm]`, ...) is part of the search text.
- Returns `{action: "back"}` immediately if no zombies.
- `enableBack: true`; `options` is `{maxItems, pageStep}`.
- Returns `{resourceType, resourceName, zone}|null|{action: "back"}`.

### `promptExceptionReason()`

- Input prompt for optional exception reason.
- Returns `string` (reason text or empty).

## Inventory flow details

### Hierarchical exploration (VM detail — option A.1)

1. User narrows the VM list by typing (substring match on name, case-insensitive, live).
2. User selects a VM from the filtered list.
3. Detail card shows: VM data, attached disks, static IPs.
4. User can select a disk to drill down into its snapshots.
5. Navigation: ← goes back one level, ESC first clears an active filter, then exits.
6. Empty states: "No disks attached.", "No snapshots found.", "No VM instances found."
7. CSV export replays `filterTerm` on the full cached set, so it exports exactly what the user was seeing; a filter matching nothing warns instead of exporting.

### Global exploration (flat lists — options A.2, A.3, A.4)

1. Resources are shown as live-filterable columnar lists (substring on name, case-insensitive).
2. `maxItems` is the initial window; a `Load more` row reveals `pageStep` more per Enter.
3. Selecting any row (or ←) returns to the inventory menu; ESC exits the command.

### Zombie flow (option B)

1. Resources are fetched (cached) and zombie detection runs.
2. Exceptions are loaded and excluded from results.
3. Zombie report is rendered (summary + categorized tables).
4. User can select a zombie to mark as exception (with optional reason).
5. Marked resources are removed from the displayed list in real-time.
6. Loop continues until no zombies remain or user exits.

## Navigation state machine

```
Level 0: Janitor Menu (enableBack: false)
  ├── "inventory" → Level 1: Inventory Menu (enableBack: true)
  │     ├── "vms" → showVMList (live filter) → VM detail → disk drill-down
  │     ├── "disks" → showDiskInventory (live filter)
  │     ├── "snapshots" → showSnapshotInventory (live filter)
  │     ├── "ips" → showAddressInventory (live filter)
  │     ├── back → Level 0
  │     └── null → exit
  ├── "zombies" → fetchAllResources → findZombieResources → renderZombieReport
  │     ├── showZombieActionMenu → promptExceptionReason → addException → loop
  │     ├── back → Level 0
  │     └── null → exit
  └── null → exit
```

### Data caching

All resources are fetched once via `Promise.all` on first use and cached for the session. The `fetchAllResources()` inner function is idempotent.

### Action routing

| Context | Action | Behavior |
|---|---|---|
| Janitor menu | `null` | Exit janitor command. |
| Inventory menu | `null` | Exit janitor command. |
| Inventory menu | `back` | Return to janitor menu. |
| VM list | `null` | Exit janitor command. |
| VM list | `back` | Return to inventory menu. |
| VM list | VM name | Show VM detail card + disk list. |
| Disk list | `null` | Exit janitor command. |
| Disk list | `back` | Return to VM list. |
| Disk list | disk name | Show disk snapshots table. |
| Zombie menu | `null` | Exit janitor command. |
| Zombie menu | `back` | Return to janitor menu. |
| Zombie menu | resource | Prompt reason, mark exception, remove from list. |

## Do

- Keep prompt functions as pure flow logic: define choices, call inquirer, return result.
- Use `enableBack: false` for Level 0, `enableBack: true` for all nested levels.
- Let the filterableList prompt do the filtering; replay `state.filterTerm` on the full set only for side effects (CSV export).
- Follow the listWithEscape and filterableList contracts from [ux.md](.claude/agents/ux.md) (parent agent).

## Do not

- Import chalk (UI territory). Visual formatting comes from `utils/ui.js` helpers.
- Use `process.stdout.write` with ANSI escape codes (UI territory).
- Call GCP SDK methods directly (call Backend's `Compute` class methods).
- Modify the visual formatting of tables or menu items.

## Overlap with UI in gcpJanitor.js

UX and UI code are interleaved. The practical rule:
- UX owns **structural** decisions: which prompts are shown, what values they carry, when to `continue` vs `break` vs `return`, how the state machine transitions.
- UI owns **visual** wrapping: all `ui.*()` calls, `render*()` functions, `formatStatusColor()`, table construction.
- When modifying this file, tag the other agent for review of their owned sections.

## See also

- [ux.md](.claude/agents/ux.md) — shared UX patterns, listWithEscape contract (parent agent).
- [backend-compute.md](.claude/agents/backend-subagents/backend-compute.md) — the Compute class API that this flow calls.
- [ui-janitor.md](.claude/agents/ui-subagents/ui-janitor.md) — the visual layer for janitor.
