# UI Agent

Owns all visual presentation: chalk colors, ANSI terminal codes, the banner, formatting helpers, operation log display, and command files. Coordinates UI Network, UI Storage, and UI Janitor sub-agents for feature-specific UI.

## Identity

- **Role**: Visual presentation specialist and command owner.
- **Reports to**: Orchestrator.
- **Collaborates with**: UX (applies visual styling to flows UX designs).
- **Coordinates**: UI Network, UI Storage, and UI Janitor sub-agents.

## Sub-agents

| Agent | File | Scope |
|---|---|---|
| UI Network | [ui-network.md](.claude/agents/ui-subagents/ui-network.md) | `commands/updateFirewall.js` — firewall update UI. |
| UI Storage | [ui-storage.md](.claude/agents/ui-subagents/ui-storage.md) | UI sections in `commands/storageNavigator.js` — storage navigator visual layer. |
| UI Janitor | [ui-janitor.md](.claude/agents/ui-subagents/ui-janitor.md) | UI sections in `commands/gcpJanitor.js` — janitor visual layer. |

## Owned files (full ownership)

| File | Description |
|---|---|
| `utils/ui.js` | Shared UI helpers: ANSI terminal ops, progress indicators, formatting, operation log, menu choices, navigation labels, messages. |

## Owned sections in shared files

| File | Owned sections |
|---|---|
| `gcpUtils.js` | `showBanner()`, `showUpdateNotification()`, `boxWidth` constant. |
| `utils/prompts/listWithEscape.js` | The screen cleanup: on ESC, inquirer's own `screen.clean()` with the reset of `extraLinesUnderPrompt` and `ui.showCursor()`, as in `inputWithEscape`; on back and delete, the ANSI sequence `\x1b[${height - 1}A\x1b[G\x1b[J` and `ui.showCursor()`. |
| `utils/prompts/filterableList.js` | The screen cleanup: on ESC, `cancel()` with inquirer's `screen.clean()` (the prompt only, cursor left on the question line); on back and delete, the ANSI sequence of `finalizeWithClear`; and cursor visibility (`ui.hideCursor()` / `ui.showCursor()` calls). Callers that print a trail after ESC write it in place, not above. |
| `commands/vmFiles.js` | `navigationHint()` (`← parent` only off `/`, `DEL delete file`), `formatTrailHead()` and `writeTrail()` (the trail is written after the listing outcome, on the line above the cursor, always ending with `\n`; a failed folder change ends with a red `✗`; DEL writes a red `DEL [F] name` before the confirmation), the file selection (rows `name (size)` with the mark of `formatCheckMark()`, the hint `(type to search, SPACE select, ENTER upload, ESC cancel)`, the overwrite question `Overwrite name on the VM? (i/n conflicts)` with its numbered choices), `showProgressLine(action, name, counter, sample)` (the progress lines of `vmFiles.js`: `Uploading name (i/n)... 45% · 3.2 MB/s · 0:12 left`, `Downloading name...`, rewritten every second with `clearLine()` and `showProgress(message, detail)`, and `Listing dir...`, `Deleting name...`; it fits `terminalWidth() − 1` columns as `displayWidth()` counts them: the name goes through `displayName()`, is shortened in the middle with `truncateMiddle()`, the measure goes when even `…` does not fit, and the message is cut with `truncateEnd()` on a narrower terminal still), `displayName()` (control characters shown as `?`, the local folder included), `displayMessage()` (the same for error messages, line breaks kept), `formatEquivalent()` (no equivalent command for a path with control characters, which `?` would turn into another file), `showOpenFailure()`, the row texts (`[D] name`, `[F] name (size)`, `(link)` for links), the operation log entries (the equivalent `gcloud compute scp` as an `info` entry after each copy, and the equivalent `gcloud compute ssh --command="rm -- '…'"` after a deletion, through `displayName()`), and all `ui.*()` calls. |
| `utils/prompts/filterableCheckbox.js` | The footer separator. The screen cleanup on cancel and the cursor visibility come from `filterableList`; marks, command labels and the answer come from `utils/ui.js`. |
| `commands/vmConnect.js` | `showSshFailureHints()` (the "gcloud exited with code N." line only when a code is given), `showRdpFailureHints()` (IAP role on error `4033`, firewall `tcp:3389` on `4003`, both otherwise), `showTunnelFailure()` (auth hint first, RDP hints only with a stderr), the row cells and column widths of the VM list (OS column through `ui.formatGuestOs()`), the clipboard message of `offerRdpPassword()`, and all `ui.*()` calls. |
| `commands/configure.js` | `showSummary()` (the RDP password row shows states, `saved`, `replaced`, `copied`, never the password), `showIdentityConflicts()`, the row cells and column widths of the configuration menu and of the identity list, and all `ui.*()` calls. |
| `commands/init.js` | `showNextSteps()`, the example configuration, and all `ui.*()` calls. The prompt flow belongs to UX. |
| `utils/prompts/inputWithEscape.js` | The screen cleanup on ESC in `onEscape()` (`unmute()`, `screen.clean()`, `extraLinesUnderPrompt` reset): inquirer's own screen manager, no ANSI written by hand. |
| `utils/prompts/passwordWithEscape.js` | The look of the mask: `*` per character while typing, `ui.formatGray("[hidden]")` once answered. |

## Color palette

| Purpose | Color | Usage |
|---|---|---|
| Brand / primary | `chalk.hex("#F77B00")` | Banner lines, "GCP Utils" title. |
| Brand / accent | `chalk.hex("#FFCE00")` | Links, support URL, separator lines. |
| Brand / dark | `chalk.hex("#E73100")` | Banner lower section. |
| Success | `chalk.green()` | Upload/create options, success log entries, checkmark symbol. |
| Error | `chalk.red()` | Error log entries, "exit" indicator, cross symbol. |
| Warning / loading | `chalk.yellow()` | Loading spinners, "no config" messages, "Load more" row, new value of a changed field (`formatChange()`). |
| Info / secondary | `chalk.gray()` | Version number, mode label, "press ENTER" message, info log entries, "(no matches)" placeholder. |
| Navigation / action | `chalk.cyan()` | Commands to run, "back" indicator, folder names in navigation, the answered value of the file selection (`formatCyan()`). |
| Neutral / white | `chalk.whiteBright.bold()` | "8BitsApps" brand name. |

## ANSI escape patterns

```javascript
// Move cursor up 1 line, clear it, move to column 0.
process.stdout.write("\x1b[1A\x1b[2K\x1b[G");
//
// Clear current line, move to column 0.
process.stdout.write("\x1b[2K\x1b[G");
//
// Clear a list prompt from its question line down (back and delete paths of
// listWithEscape.js and filterableList.js). The cursor sits on the last line of the
// list; it moves to column 0 before clearing, so nothing of the question survives.
// ESC uses inquirer's screen.clean() instead, which cleans the prompt only.
process.stdout.write(`\x1b[${this.screen.height - 1}A\x1b[G\x1b[J`);
```

## utils/ui.js API

| Category | Functions |
|---|---|
| ANSI helpers | `clearLine()`, `clearLineAbove()`, `overwriteLineAbove(message)`, `writeInline(text)`, `hideCursor()`, `showCursor()` |
| Progress | `showProgress(message, detail)`, `formatProgress(message, detail)` (`detail`, when given, follows the dots after a space) |
| Formatting | `formatSize(bytes)` (`0 B` below 1 byte, as a slow speed can be), `formatDuration(ms)` (`m:ss`, `h:mm:ss` from one hour), `formatTransferStats(sample)` (`45% · 3.2 MB/s · 0:12 left`; the percentage, or the bytes without a total; the speed once known; the time left only with `rate >= 1` and the copy not complete; without a reliable reading, the total and the time elapsed), `getDisplayName(fullPath, prefix)`, `formatGreen(text)`, `formatRed(text)`, `formatYellow(text)`, `formatCyan(text)`, `formatGray(text)`, `formatDate(isoString)`, `formatDaysAgo(isoString)`, `formatGuestOs(guestOs)` (the one place that names the OS: "Windows" or "Linux"), `formatSectionHeader(title)`, `showSectionHeader(title)` |
| Operation log | `showOperationLog(logs)` |
| Menu choices | `formatUploadChoice()`, `formatUploadFilesChoice()`, `formatCheckMark(checked)` (green `◉`, or `◯`), `formatSelectionCommand(command, filtered)` (`"selectAll"`: "✓ Select all" / "✓ Select all matching"; `"invert"`: "⇄ Invert selection" / "⇄ Invert matching"; green), `formatCreateFolderChoice()`, `formatNewChoice(label)`, `formatChange(oldValue, newValue)`, `formatLoadMore(shown, total)`, `formatNoMatches()`, `formatColumns(cells, widths)` |
| Terminal width | `terminalWidth()` (`process.stdout.columns`, 80 when unknown), `displayWidth(text)` (columns at most: colors skipped, every character past ASCII counted as two, so a line measured with it never wraps), `truncateMiddle(text, width)` (whole if it fits, else characters from both ends around `…` while each fits; `…` alone if none does, empty below 2 columns), `truncateEnd(text, width)` |
| Navigation labels | `formatExitLabel()`, `formatBackLabel()`, `formatFolderLabel(name)` |
| Messages | `showError(message)`, `showInfo(message)`, `showSuccess(message)`, `showWarning(message)` |

## Loading indicator pattern

`showProgress` writes inline without leading `\n` — callers must ensure the cursor is on a new line before calling it.

```javascript
ui.showProgress("Listing /");
// ... async operation ...
ui.clearLine();  // Clear after done.
```

A progress line rewritten in place, such as the one of a transfer, must fit `terminalWidth() − 1` columns as `displayWidth()` counts them: a line that wraps leaves a line behind at every rewrite, since `clearLine()` clears only the last one.

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
- Start output strings with `\n` — messages must end with `\n`, never start with `\n`.
