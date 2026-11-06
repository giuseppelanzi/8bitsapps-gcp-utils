const childProcess = require("child_process");
//
// How long a secret stays in the clipboard, at most.
const CLEAR_AFTER_MS = 45000;
//
// Marker of the nspasteboard.org convention: clipboard history managers (Maccy,
// Raycast, Alfred, Paste) skip a clipboard that carries it.
const CONCEALED_TYPE = "org.nspasteboard.ConcealedType";
//
// JXA that copies stdin to the clipboard, marked as concealed, and prints the change
// count. The secret arrives on stdin, never in the script, which ps would show.
const COPY_SCRIPT = [
  "ObjC.import(\"AppKit\");",
  "const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;",
  "const text = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);",
  "const pb = $.NSPasteboard.generalPasteboard;",
  "pb.clearContents;",
  "pb.setStringForType(text, \"public.utf8-plain-text\");",
  `pb.setStringForType($(""), "${CONCEALED_TYPE}");`,
  "String(pb.changeCount);"
].join("\n");
//
/**
 * Builds the JXA that empties the clipboard only if it still holds the copied secret.
 * The change count tells, so the content is never read. JXA bridges it as a string,
 * hence the Number() before the comparison.
 * @param {number} changeCount - Change count returned by copySecret().
 * @returns {string} The script.
 */
function clearScript(changeCount) {
  return [
    "ObjC.import(\"AppKit\");",
    "const pb = $.NSPasteboard.generalPasteboard;",
    `if (Number(pb.changeCount) === ${Number(changeCount)}) { pb.clearContents; }`,
    "\"\";"
  ].join("\n");
}
//
/**
 * Starts a detached osascript that clears the clipboard after a delay, if it still
 * holds the secret. It does not depend on this tool: it works after Ctrl+C too.
 * @param {number} changeCount - Change count returned by copySecret().
 * @param {number} delayMs - Delay before clearing.
 */
function scheduleClear(changeCount, delayMs) {
  const script = `delay(${delayMs / 1000});\n${clearScript(changeCount)}`;
  const child = childProcess.spawn("osascript", ["-l", "JavaScript", "-e", script], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}
//
/**
 * Copies a secret to the clipboard, marked as concealed, and schedules its removal.
 * @param {string} text - The secret.
 * @param {{clearAfterMs?: number}} [options] - Delay before clearing, CLEAR_AFTER_MS by default.
 * @returns {Promise<number>} The change count of the clipboard, for clearSecret().
 * @throws {Error} Outside macOS, or if osascript fails.
 */
function copySecret(text, options = {}) {
  const clearAfterMs = options.clearAfterMs || CLEAR_AFTER_MS;
  if (process.platform !== "darwin") {
    return Promise.reject(new Error("Copying to the clipboard is supported only on macOS."));
  }
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn("osascript", ["-l", "JavaScript", "-e", COPY_SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", err => reject(new Error(`Could not copy to the clipboard: ${err.message}`)));
    child.on("close", code => {
      const changeCount = Number(stdout.trim());
      if (code !== 0 || !Number.isInteger(changeCount)) {
        reject(new Error(`Could not copy to the clipboard${stderr.trim() ? `: ${stderr.trim()}` : "."}`));
        return;
      }
      scheduleClear(changeCount, clearAfterMs);
      resolve(changeCount);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(text);
  });
}
//
/**
 * Empties the clipboard now, if it still holds the copied secret. It is cleanup, so
 * it never rejects: callers run it from timers and finally blocks.
 * @param {number|null} changeCount - Change count returned by copySecret(), or null for nothing to clear.
 * @returns {Promise<void>}
 */
function clearSecret(changeCount) {
  if (changeCount === null || changeCount === undefined) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const child = childProcess.spawn("osascript", ["-l", "JavaScript", "-e", clearScript(changeCount)], { stdio: "ignore" });
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
}
//
module.exports = {
  CLEAR_AFTER_MS,
  copySecret,
  clearSecret
};
