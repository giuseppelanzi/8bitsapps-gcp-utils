const chalk = require("chalk");
//
// --- ANSI terminal helpers. ---
//
/**
 * Clears the current line and moves cursor to column 0.
 */
function clearLine() {
  process.stdout.write("\x1b[2K\x1b[G");
}
//
/**
 * Moves cursor up one line, clears it, and moves cursor to column 0.
 */
function clearLineAbove() {
  process.stdout.write("\x1b[1A\x1b[2K\x1b[G");
}
//
/**
 * Moves cursor up one line, clears it, and writes a message in its place.
 * @param {string} message - The message to write on the cleared line.
 */
function overwriteLineAbove(message) {
  process.stdout.write(`\x1b[1A\x1b[2K\x1b[G${message}`);
}
//
/**
 * Writes text to stdout without a trailing newline.
 * @param {string} text - Text to write.
 */
function writeInline(text) {
  process.stdout.write(text);
}
//
/**
 * Prints a blank line.
 */
function blankLine() {
  console.log();
}
//
/**
 * Hides the terminal cursor.
 */
function hideCursor() {
  process.stdout.write("\x1b[?25l");
}
//
/**
 * Shows the terminal cursor.
 */
function showCursor() {
  process.stdout.write("\x1b[?25h");
}
//
// --- Progress indicators. ---
//
/**
 * Shows a progress indicator, without a newline.
 * @param {string} message - Progress message (without trailing dots).
 * @param {string} [detail] - Text after the dots, such as the measure of a transfer.
 */
function showProgress(message, detail) {
  process.stdout.write(formatProgress(message, detail));
}
//
/**
 * Returns a formatted progress string (no newline, no I/O).
 * @param {string} message - Progress message (without trailing dots).
 * @param {string} [detail] - Text after the dots, such as the measure of a transfer.
 * @returns {string} Chalk-formatted progress string.
 */
function formatProgress(message, detail) {
  return chalk.yellow(`\u23f3 ${message}...${detail ? ` ${detail}` : ""}`);
}
//
// --- Formatting helpers. ---
//
/**
 * Formats file size in human readable format. Below 1 byte, as a slow speed can be,
 * the size is "0 B": the logarithm would otherwise pick a unit that does not exist.
 * @param {number} bytes - Size in bytes.
 * @returns {string} Formatted size.
 */
function formatSize(bytes) {
  if (!(bytes >= 1)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
//
/**
 * Formats a duration as m:ss, or h:mm:ss from one hour on.
 * @param {number} ms - Duration in milliseconds.
 * @returns {string} Formatted duration.
 */
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}
//
/**
 * Formats the measure of a transfer, for the text after the dots of its progress line.
 * Without a reliable reading: the total size and the time elapsed, or the time alone.
 * With one: the percentage, or the bytes when the total is unknown, then the speed once
 * known, then the time left, only when it can be estimated and the copy is not complete.
 * @param {{bytes: number|null, total: number|null, rate: number|null, elapsedMs: number}} sample - Measure, see remoteFiles.watchTransfer().
 * @returns {string} The measure.
 */
function formatTransferStats(sample) {
  if (sample.bytes === null) {
    const elapsed = formatDuration(sample.elapsedMs);
    return sample.total === null ? elapsed : `${formatSize(sample.total)} · ${elapsed}`;
  }
  const parts = [];
  if (sample.total === null) {
    parts.push(formatSize(sample.bytes));
  } else {
    const percent = sample.total > 0 ? Math.floor(Math.min(sample.bytes, sample.total) / sample.total * 100) : 100;
    parts.push(`${percent}%`);
  }
  if (sample.rate !== null) {
    parts.push(`${formatSize(sample.rate)}/s`);
    if (sample.total !== null && sample.rate >= 1 && sample.bytes < sample.total) {
      parts.push(`${formatDuration(Math.ceil((sample.total - sample.bytes) / sample.rate) * 1000)} left`);
    }
  }
  return parts.join(" · ");
}
//
/**
 * Extracts the display name from a full path.
 * @param {string} fullPath - The full path.
 * @param {string} prefix - The current prefix.
 * @returns {string} The display name.
 */
function getDisplayName(fullPath, prefix) {
  return fullPath.slice(prefix.length);
}
//
/**
 * Formats text in green.
 * @param {string} text - Text to format.
 * @returns {string} Chalk-formatted green text.
 */
function formatGreen(text) {
  return chalk.green(text);
}
//
/**
 * Formats text in red.
 * @param {string} text - Text to format.
 * @returns {string} Chalk-formatted red text.
 */
function formatRed(text) {
  return chalk.red(text);
}
//
/**
 * Formats text in yellow.
 * @param {string} text - Text to format.
 * @returns {string} Chalk-formatted yellow text.
 */
function formatYellow(text) {
  return chalk.yellow(text);
}
//
/**
 * Formats text in cyan, as inquirer shows an answer.
 * @param {string} text - Text to format.
 * @returns {string} Chalk-formatted cyan text.
 */
function formatCyan(text) {
  return chalk.cyan(text);
}
//
/**
 * Formats text in gray.
 * @param {string} text - Text to format.
 * @returns {string} Chalk-formatted gray text.
 */
function formatGray(text) {
  return chalk.gray(text);
}
//
/**
 * Formats an ISO timestamp to a short date string.
 * @param {string} isoString - ISO 8601 timestamp.
 * @returns {string} Formatted date or "-".
 */
function formatDate(isoString) {
  if (!isoString) return "-";
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
//
/**
 * Calculates how many days ago a timestamp was.
 * @param {string} isoString - ISO 8601 timestamp.
 * @returns {string} Human-readable "X days" or "-".
 */
function formatDaysAgo(isoString) {
  if (!isoString) return "-";
  const days = Math.floor((Date.now() - new Date(isoString).getTime()) / 86400000);
  return `${days} days`;
}
//
/**
 * Formats the guest operating system of a VM, the one place that names it.
 * @param {string} guestOs - "windows" or "linux", from Compute.detectGuestOs().
 * @returns {string} "Windows" or "Linux".
 */
function formatGuestOs(guestOs) {
  return guestOs === "windows" ? "Windows" : "Linux";
}
//
/**
 * Formats a section header with brand color.
 * @param {string} title - Section title.
 * @returns {string} Chalk-formatted section header.
 */
function formatSectionHeader(title) {
  return chalk.hex("#F77B00").bold(title);
}
//
/**
 * Prints a section header with blank line above for spacing.
 * @param {string} title - Section title.
 */
function showSectionHeader(title) {
  console.log();
  console.log(chalk.hex("#F77B00").bold(title));
}
//
// --- Operation log rendering. ---
//
/**
 * Renders operation log entries with colored symbols.
 * @param {Array<{type: string, message: string}>} logs - Log entries.
 */
function showOperationLog(logs) {
  if (logs.length === 0) return;
  //
  for (const log of logs) {
    if (log.type === "success") {
      console.log(chalk.green(` \u2713 ${log.message}`));
    } else if (log.type === "error") {
      console.log(chalk.red(` \u2717 ${log.message}`));
    } else {
      console.log(chalk.gray(` \u00b7 ${log.message}`));
    }
  }
}
//
// --- Menu choice formatting. ---
//
/**
 * Formats the "Upload file here" menu choice.
 * @returns {string} Chalk-formatted string.
 */
function formatUploadChoice() {
  return chalk.green("\u2191 Upload file here");
}
//
/**
 * Formats the "Upload files here" menu choice, for uploads of several files at once.
 * @returns {string} Chalk-formatted string.
 */
function formatUploadFilesChoice() {
  return chalk.green("↑ Upload files here");
}
//
/**
 * Formats the selection mark of a row in a multiple choice.
 * @param {boolean} checked - Whether the row is selected.
 * @returns {string} A green filled circle, or an empty one.
 */
function formatCheckMark(checked) {
  return checked ? chalk.green("◉") : "◯";
}
//
/**
 * Formats a command row of a multiple choice.
 * @param {string} command - "selectAll" or "invert".
 * @param {boolean} filtered - Whether a filter is active, so the command acts on its matches only.
 * @returns {string} Chalk-formatted string.
 */
function formatSelectionCommand(command, filtered) {
  if (command === "selectAll") {
    return chalk.green(filtered ? "✓ Select all matching" : "✓ Select all");
  }
  return chalk.green(filtered ? "⇄ Invert matching" : "⇄ Invert selection");
}
//
/**
 * Formats the "Create folder here" menu choice.
 * @returns {string} Chalk-formatted string.
 */
function formatCreateFolderChoice() {
  return chalk.green("+ Create folder here");
}
//
/**
 * Formats a "+ New …" menu choice.
 * @param {string} label - Choice label, without the leading "+".
 * @returns {string} Chalk-formatted string.
 */
function formatNewChoice(label) {
  return chalk.green(`+ ${label}`);
}
//
/**
 * Formats a changed value for a summary, as "old → new".
 * @param {string} oldValue - Value before the change, empty for none.
 * @param {string} newValue - Value after the change, empty for none.
 * @returns {string} Chalk-formatted string.
 */
function formatChange(oldValue, newValue) {
  const before = oldValue ? chalk.gray(oldValue) : chalk.gray("(none)");
  const after = newValue ? chalk.yellow(newValue) : chalk.yellow("(none)");
  return `${before} \u2192 ${after}`;
}
//
/**
 * Formats the "load more" menu row.
 * @param {number} shown - Items currently shown.
 * @param {number} total - Total matching items.
 * @returns {string} Chalk-formatted string.
 */
function formatLoadMore(shown, total) {
  return chalk.yellow(`▼ Load more (${shown}/${total})`);
}
//
/**
 * Formats the "no matches" placeholder for filtered lists.
 * @returns {string} Chalk-formatted string.
 */
function formatNoMatches() {
  return chalk.gray("(no matches)");
}
//
/**
 * Returns the characters of a string that reach the screen, skipping ANSI color sequences.
 * @param {string} text - Text possibly containing chalk colors.
 * @returns {string[]} The visible characters, one code point each.
 */
function visibleChars(text) {
  const chars = [];
  let inEscape = false;
  for (const ch of text) {
    if (inEscape) {
      if (ch === "m") inEscape = false;
    } else if (ch === "\x1b") {
      inEscape = true;
    } else {
      chars.push(ch);
    }
  }
  return chars;
}
//
/**
 * Measures the visible width of a string, skipping ANSI color sequences.
 * @param {string} text - Text possibly containing chalk colors.
 * @returns {number} Visible character count.
 */
function visibleLength(text) {
  return visibleChars(text).length;
}
//
/**
 * Formats cells into fixed-width columns (padEnd on visible length).
 * Cells wider than their column are left untruncated.
 * @param {Array<string|number>} cells - Cell values (may contain chalk colors).
 * @param {number[]} widths - Column widths.
 * @returns {string} Single columnar row.
 */
function formatColumns(cells, widths) {
  const padded = cells.map((cell, i) => {
    const text = String(cell);
    const padding = (widths[i] || 0) - visibleLength(text);
    return padding > 0 ? text + " ".repeat(padding) : text;
  });
  return padded.join("  ").trimEnd();
}
//
// --- Terminal width. ---
//
// Width assumed when the terminal does not tell its own.
const DEFAULT_TERMINAL_WIDTH = 80;
//
// Mark of a shortened text, and its width as displayWidth() counts it.
const ELLIPSIS = "…";
const ELLIPSIS_WIDTH = 2;
//
// Last code point counted as one column: printable ASCII.
const LAST_NARROW_CODE_POINT = 0x7e;
//
/**
 * Returns the width of the terminal.
 * @returns {number} Columns, DEFAULT_TERMINAL_WIDTH when unknown.
 */
function terminalWidth() {
  return process.stdout.columns || DEFAULT_TERMINAL_WIDTH;
}
//
/**
 * Measures the columns a text may take, skipping ANSI color sequences. The count errs
 * on the wide side: every character past ASCII counts two columns, emoji and CJK
 * included, so a line measured with it never wraps.
 * @param {string} text - Text possibly containing chalk colors.
 * @returns {number} Columns, at most.
 */
function displayWidth(text) {
  return visibleChars(text).reduce((width, ch) => width + (ch.codePointAt(0) > LAST_NARROW_CODE_POINT ? 2 : 1), 0);
}
//
/**
 * Shortens a plain text in the middle with "…", so both ends, an extension among them,
 * stay visible. Characters are taken from the two ends in turn, each only if it fits;
 * the result never exceeds the width, as displayWidth() counts it.
 * @param {string} text - Plain text, without colors.
 * @param {number} width - Columns available.
 * @returns {string} The text, whole if it fits; "…" alone if no character fits beside it; empty below the width of "…".
 */
function truncateMiddle(text, width) {
  if (displayWidth(text) <= width) {
    return text;
  }
  if (width < ELLIPSIS_WIDTH) {
    return "";
  }
  const chars = Array.from(text);
  const budget = width - ELLIPSIS_WIDTH;
  let head = 0;
  let tail = 0;
  let used = 0;
  let headFull = false;
  let tailFull = false;
  let fromHead = true;
  while (!(headFull && tailFull) && head + tail < chars.length) {
    const takeHead = tailFull || (fromHead && !headFull);
    const ch = takeHead ? chars[head] : chars[chars.length - 1 - tail];
    const charWidth = displayWidth(ch);
    if (used + charWidth > budget) {
      headFull = headFull || takeHead;
      tailFull = tailFull || !takeHead;
    } else {
      used += charWidth;
      head += takeHead ? 1 : 0;
      tail += takeHead ? 0 : 1;
    }
    fromHead = !fromHead;
  }
  return `${chars.slice(0, head).join("")}${ELLIPSIS}${chars.slice(chars.length - tail).join("")}`;
}
//
/**
 * Cuts a plain text at the end, so it never exceeds the width, as displayWidth() counts it.
 * @param {string} text - Plain text, without colors.
 * @param {number} width - Columns available.
 * @returns {string} The beginning of the text that fits.
 */
function truncateEnd(text, width) {
  let used = 0;
  let result = "";
  for (const ch of text) {
    const charWidth = displayWidth(ch);
    if (used + charWidth > width) {
      break;
    }
    used += charWidth;
    result += ch;
  }
  return result;
}
//
// --- Navigation labels. ---
//
/**
 * Formats the "exit" label for navigation trail.
 * @returns {string} Chalk-formatted exit label.
 */
function formatExitLabel() {
  return chalk.red("<- exit");
}
//
/**
 * Formats the "back" label for navigation trail.
 * @returns {string} Chalk-formatted back label.
 */
function formatBackLabel() {
  return chalk.cyan("<- back");
}
//
/**
 * Formats a folder name for the navigation trail.
 * @param {string} folderDisplayName - Display name of folder.
 * @returns {string} Chalk-formatted folder label.
 */
function formatFolderLabel(folderDisplayName) {
  return chalk.cyan(`[D] ${folderDisplayName}`);
}
//
// --- Messages. ---
//
/**
 * Prints an error message in red.
 * @param {string} message - Error message.
 */
function showError(message) {
  console.log(chalk.red(message));
}
//
/**
 * Prints an info message in cyan.
 * @param {string} message - Info message.
 */
function showInfo(message) {
  console.log(chalk.cyan(message));
}
//
/**
 * Prints a success message in green.
 * @param {string} message - Success message.
 */
function showSuccess(message) {
  console.log(chalk.green(message));
}
//
/**
 * Prints a warning message in yellow.
 * @param {string} message - Warning message.
 */
function showWarning(message) {
  console.log(chalk.yellow(message));
}
//
module.exports = {
  // ANSI helpers.
  clearLine,
  clearLineAbove,
  overwriteLineAbove,
  writeInline,
  blankLine,
  hideCursor,
  showCursor,
  // Progress.
  showProgress,
  formatProgress,
  // Formatting.
  formatSize,
  formatDuration,
  formatTransferStats,
  getDisplayName,
  formatGreen,
  formatRed,
  formatYellow,
  formatCyan,
  formatGray,
  formatDate,
  formatDaysAgo,
  formatGuestOs,
  formatSectionHeader,
  showSectionHeader,
  // Operation log.
  showOperationLog,
  // Menu choices.
  formatUploadChoice,
  formatUploadFilesChoice,
  formatCheckMark,
  formatSelectionCommand,
  formatCreateFolderChoice,
  formatNewChoice,
  formatChange,
  formatLoadMore,
  formatNoMatches,
  formatColumns,
  // Terminal width.
  terminalWidth,
  displayWidth,
  truncateMiddle,
  truncateEnd,
  // Navigation labels.
  formatExitLabel,
  formatBackLabel,
  formatFolderLabel,
  // Messages.
  showError,
  showInfo,
  showSuccess,
  showWarning
};
