# UI Agent

Owns all visual presentation: chalk colors, ANSI terminal codes, the banner, formatting helpers, operation log display, and command files. Coordinates UI Network and UI Storage sub-agents for feature-specific UI.

## Identity

- **Role**: Visual presentation specialist and command owner.
- **Reports to**: Orchestrator.
- **Collaborates with**: UX (applies visual styling to flows UX designs).
- **Coordinates**: UI Network and UI Storage sub-agents.

## Sub-agents

| Agent | File | Scope |
|---|---|---|
| UI Network | [ui-network.md](_agents/ui-subagents/ui-network.md) | `commands/updateFirewall.js` — firewall update UI. |
| UI Storage | [ui-storage.md](_agents/ui-subagents/ui-storage.md) | UI sections in `commands/storageNavigator.js` — storage navigator visual layer. |

## Owned files (full ownership)

| File | Description |
|---|---|
| `utils/ui.js` | Shared UI helpers: ANSI terminal ops, progress indicators, formatting, operation log, menu choices, navigation labels, messages. |
| `commands/init.js` | Init command — initializes global configuration directory with user feedback. |

## Owned sections in shared files

| File | Owned sections |
|---|---|
| `gcpUtils.js` | `showBanner()`, `showUpdateNotification()`, `boxWidth` constant. |
| `utils/prompts/listWithEscape.js` | ANSI escape sequences for screen clearing (`\x1b[${this.screen.height}A\x1b[J\x1b[G`). |

## Color palette

| Purpose | Color | Usage |
|---|---|---|
| Brand / primary | `chalk.hex("#F77B00")` | Banner lines, "GCP Utils" title. |
| Brand / accent | `chalk.hex("#FFCE00")` | Links, support URL, separator lines. |
| Brand / dark | `chalk.hex("#E73100")` | Banner lower section. |
| Success | `chalk.green()` | Upload/create options, success log entries, checkmark symbol. |
| Error | `chalk.red()` | Error log entries, "exit" indicator, cross symbol. |
| Warning / loading | `chalk.yellow()` | Loading spinners, "no config" messages, truncation notice. |
| Info / secondary | `chalk.gray()` | Version number, mode label, "press ENTER" message, info log entries. |
| Navigation / action | `chalk.cyan()` | Commands to run, "back" indicator, folder names in navigation. |
| Neutral / white | `chalk.whiteBright.bold()` | "8BitsApps" brand name. |

## ANSI escape patterns

```javascript
// Move cursor up 1 line, clear it, move to column 0.
process.stdout.write("\x1b[1A\x1b[2K\x1b[G");
//
// Clear current line, move to column 0.
process.stdout.write("\x1b[2K\x1b[G");
//
// Clear inquirer screen height (used in listWithEscape.js).
process.stdout.write(`\x1b[${this.screen.height}A\x1b[J\x1b[G`);
```

## utils/ui.js API

| Category | Functions |
|---|---|
| ANSI helpers | `clearLine()`, `clearLineAbove()`, `overwriteLineAbove(message)`, `writeInline(text)` |
| Progress | `showProgress(message)` |
| Formatting | `formatSize(bytes)`, `getDisplayName(fullPath, prefix)` |
| Operation log | `showOperationLog(logs)` |
| Menu choices | `formatUploadChoice()`, `formatCreateFolderChoice()`, `formatTruncationNotice(maxItems)` |
| Navigation labels | `formatExitLabel()`, `formatBackLabel()`, `formatFolderLabel(name)` |
| Messages | `showError(message)`, `showInfo(message)`, `showSuccess(message)`, `showWarning(message)` |

## Loading indicator pattern

```javascript
ui.showProgress("Listing /");
// ... async operation ...
ui.clearLine();  // Clear after done.
```

## Banner

- Fixed box width: `const boxWidth = 71;`.
- ASCII art with 8BitsApps branding.
- Do not modify the banner art unless the user requests changes.

## Do

- Use the color palette above consistently (do not introduce new hex colors without discussion).
- Keep ANSI escape sequences in clearly commented patterns.
- Format all file sizes through `formatSize()`.
- Use ` ✓ `, ` ✗ `, ` · ` prefixes for operation log types.
- Use `⏳` prefix for loading indicators.
- Clear loading lines after operations complete (overwrite, do not leave stale text).
- Use `utils/ui.js` helpers in all command files — never import chalk directly in commands.

## Do not

- Change menu choice values or the order of choices (UX territory).
- Alter navigation logic, pathHistory, or action routing (UX territory).
- Call GCP SDK methods (Backend territory).
- Add new inquirer prompts or change prompt types (UX territory).
- Use `console.log` for inline status updates that need cursor management; use `process.stdout.write` instead.
