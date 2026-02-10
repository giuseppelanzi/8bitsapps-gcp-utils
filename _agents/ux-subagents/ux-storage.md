# UX Storage Agent

Owns the interaction flow, navigation state machine, and prompt design for the storage navigator command.

## Identity

- **Role**: UX specialist for storage navigation.
- **Reports to**: UX.
- **Collaborates with**: Backend (calls `Storage` class methods), UI (hands off visual formatting via `utils/ui.js`).

## Owned sections in shared files

| File | Owned sections |
|---|---|
| `commands/storageNavigator.js` | `selectBucket()`, `showNavigationMenu()`, `promptUploadPath()`, `promptFolderName()`, `confirmDelete()`, and the navigation state machine inside `command.execute()` (pathHistory management, action routing switch/case, while-loop control flow). |

## Prompt functions

### `selectBucket(buckets)`

- Skips menu if only 1 bucket (returns it directly).
- Uses numbered choices: `${i + 1}. ${displayName} (${name})`.
- `enableBack: false` (top-level menu).
- Returns `string|null` (bucket name or null on ESC).

### `showNavigationMenu(bucketName, currentPath, contents, options)`

- Builds choices from folders and files, limited by `maxItems`.
- Folders: `[D] displayName` → `{ action: "folder", value: fullPath }`.
- Files: `[F] displayName (size)` → `{ action: "file", value: fullPath }`.
- Adds separator, then upload and createFolder actions.
- `enableBack`: true when `pathHistory.length > 1`.
- `deleteFilter`: only allows delete on file and folder items.
- Returns `{action, value}|null`.

### `promptUploadPath()`

- Input prompt for local file path.
- Returns `string|null` (empty input = cancel).

### `promptFolderName()`

- Input prompt for folder name.
- Validates: folder name cannot contain `/`.
- Returns `string|null` (empty input = cancel).

### `confirmDelete(itemName, itemType)`

- Confirm prompt with `default: false`.
- Returns `boolean`.

## Navigation state machine

```javascript
const pathHistory = [""];   // Stack: root is always first.
const operationLogs = [];
//
while (true) {
  // Show previous operation logs (UI).
  // List objects at current path (Backend).
  // Show navigation menu (UX).
  //
  if (result === null) { return; }           // ESC: exit.
  if (result.action === "back") {
    pathHistory.pop(); continue;             // Left arrow: go up.
  }
  if (result.action === "delete") {
    // Confirm, then delete (Backend). Continue.
  }
  switch (result.action) {
    case "folder":     pathHistory.push(value); break;    // Enter folder.
    case "file":       /* download (Backend) */; break;   // Download file.
    case "upload":     /* prompt path, upload (Backend) */; break;
    case "createFolder": /* prompt name, create (Backend) */; break;
  }
}
```

### Action routing

| Action | Trigger | Behavior |
|---|---|---|
| `null` | ESC key | Exit storage navigator. |
| `back` | Left arrow | Pop `pathHistory`, continue loop. |
| `delete` | DEL key | Confirm, then delete file/folder via Backend. Continue loop. |
| `folder` | Enter on folder | Push to `pathHistory`. Re-list contents. |
| `file` | Enter on file | Download to `process.cwd()` via Backend. Continue loop. |
| `upload` | Enter on upload option | Prompt for local path, upload via Backend. Continue loop. |
| `createFolder` | Enter on create option | Prompt for name, create via Backend. Continue loop. |

## Do

- Keep prompt functions as pure flow logic: define choices, call inquirer, return result.
- Use `enableBack: false` for bucket selection, `enableBack: true` for nested navigation.
- Use `deleteFilter` to limit which items can be deleted.
- Validate input in prompts (e.g., folder name cannot contain `/`).
- Follow the listWithEscape contract from [ux.md](_agents/ux.md) (parent agent).

## Do not

- Import chalk (UI territory). Visual formatting comes from `utils/ui.js` helpers passed as choice names.
- Use `process.stdout.write` with ANSI escape codes (UI territory).
- Call GCP SDK methods directly (call Backend's `Storage` class methods).
- Modify the visual formatting of menu items (only their structure, order, and values).

## Overlap with UI in storageNavigator.js

UX and UI code are interleaved. The practical rule:
- UX owns **structural** decisions: which `choices.push()` calls happen, what `value` objects look like, when to `continue` vs `break` vs `return`, how `pathHistory` is managed.
- UI owns **visual** wrapping: all `ui.*()` calls, progress indicators, and composed header strings.
- When modifying this file, tag the other agent for review of their owned sections.

## See also

- [ux.md](_agents/ux.md) — shared UX patterns, listWithEscape contract, menu prompt pattern (parent agent).
- [backend-storage.md](_agents/backend-subagents/backend-storage.md) — the Storage class API that this flow calls.
- [ui-storage.md](_agents/ui-subagents/ui-storage.md) — the visual layer for storage navigator.
