# UI Storage Agent

Owns the visual presentation layer for storage operations in the storage navigator command.

## Identity

- **Role**: UI specialist for storage operations.
- **Reports to**: UI.
- **Collaborates with**: UX (storage navigator flow calls `ui.*` helpers), Backend Storage (provides data that gets formatted).

## Owned sections in shared files

| File | Owned sections |
|---|---|
| `commands/storageNavigator.js` | All `ui.*()` calls and visual presentation strings. |

## Detailed ownership in storageNavigator.js

### Progress and line management

- `ui.showProgress(message)` — loading indicators (e.g., `"Listing /"`, `"Downloading file.txt"`).
- `ui.clearLine()` — clears loading line after operation completes.
- `ui.clearLineAbove()` — clears inquirer's colored line.
- `ui.overwriteLineAbove(message)` — replaces inquirer line with navigation trail.
- `ui.writeInline(text)` — writes text without newline.

### Operation log and error display

- `ui.showOperationLog(operationLogs)` — renders success/error/info entries at top of each loop iteration.
- `ui.showError(message)` — error messages (e.g., `"No buckets configured..."`, `"Error listing objects: ..."`).

### Menu choice formatting

- `ui.formatUploadChoice()` — green "Upload file here" option.
- `ui.formatCreateFolderChoice()` — green "Create folder here" option.
- `ui.formatTruncationNotice(maxItems)` — yellow truncation notice.

### Navigation trail labels

- `ui.formatExitLabel()` — red "← exit" label when ESC is pressed.
- `ui.formatBackLabel()` — cyan "← back" label when going up.
- `ui.formatFolderLabel(name)` — cyan "[D] name" label when entering a folder.

### Data formatting helpers

- `ui.formatSize(bytes)` — human-readable file size (e.g., `"1.5 MB"`).
- `ui.getDisplayName(fullPath, prefix)` — extracts display name from full path.

### Composed header strings

Navigation menu header composition follows this pattern:
```javascript
// On ESC exit.
`? ${bucketName}:${displayPath} ${exitHint} ${ui.formatExitLabel()}`
//
// On back navigation.
`? ${bucketName}:${displayPath} (← back, DEL delete, ESC exit) ${ui.formatBackLabel()}`
//
// On folder enter.
`? ${bucketName}:${displayPath} (← back, DEL delete, ESC exit) ${ui.formatFolderLabel(name)}`
```

## Operation log entry pattern

All storage operations follow this visual pattern:

```javascript
ui.showProgress(`Downloading ${fileName}`);
try {
  await storage.someMethod(...);
  ui.clearLine();
  operationLogs.push({ type: "success", message: `Downloaded: ${fileName} → ${localPath}` });
} catch (err) {
  ui.clearLine();
  operationLogs.push({ type: "error", message: `Download failed: ${fileName} - ${err.message}` });
}
```

Pattern: **show progress → backend call → clear line → push to operationLogs**.

## Operation log messages

| Operation | Success message | Error message |
|---|---|---|
| Download | `Downloaded: ${fileName} → ${localPath}` | `Download failed: ${fileName} - ${err.message}` |
| Upload | `Uploaded: ${fileName} → ${bucket}/${remotePath}` | `Upload failed: ${fileName} - ${err.message}` |
| Create folder | `Folder created: ${name} at ${bucket}:${path}` | `Create folder failed: ${name} - ${err.message}` |
| Delete file | `Deleted file "${name}"` | `Delete failed: ${name} - ${err.message}` |
| Delete folder | `Deleted folder "${name}" (${count} files)` | `Delete failed: ${name} - ${err.message}` |

## Do

- Use `utils/ui.js` methods for all visual output.
- Follow the operation log entry pattern consistently.
- Always clear the loading line (`ui.clearLine()`) after async operations.
- Use color palette defined in [ui.md](_agents/ui.md) (parent agent).

## Do not

- Modify UX flow logic (action routing, `pathHistory`, `switch/case`, `while` loop) — UX territory.
- Call GCP SDK methods directly — use Backend Storage's `Storage` class.
- Import chalk directly in storageNavigator.js — use `utils/ui.js` helpers.
- Modify `selectBucket()`, `showNavigationMenu()`, `promptUploadPath()`, `promptFolderName()`, `confirmDelete()` structure — UX territory.

## See also

- [ui.md](_agents/ui.md) — general UI patterns, color palette, `utils/ui.js` ownership (parent agent).
- [backend-storage.md](_agents/backend-subagents/backend-storage.md) — the backend layer whose data gets formatted.
- [ui-network.md](_agents/ui-subagents/ui-network.md) — peer agent for network UI.
