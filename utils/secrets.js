const childProcess = require("child_process");
const paths = require("./paths.js");
//
// Keychain item of the RDP password of a configuration: a generic password whose
// account is the path of the configuration file, unique across local and global mode.
const KEYCHAIN_SERVICE = "8bitsapps-gcp-utils-rdp";
const KEYCHAIN_LABEL = "8bitsapps-gcp-utils RDP";
//
// Exit code of security when the item does not exist (errSecItemNotFound).
const ITEM_NOT_FOUND = 44;
//
// Characters the command language of "security -i" cannot carry inside double quotes.
const UNQUOTABLE_PATTERN = /["\\\r\n]/;
//
// What security returns for an item written by this tool: base64 text.
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
//
/**
 * Tells whether RDP passwords can be kept on this system: only the macOS keychain is supported.
 * @returns {boolean} True on macOS.
 */
function isSupported() {
  return process.platform === "darwin";
}
//
/**
 * Returns the keychain account of a configuration: the path of its file.
 * @param {string} configName - Configuration name.
 * @returns {string} The account.
 */
function keychainAccount(configName) {
  return paths.getConfigPath(configName);
}
//
/**
 * Runs the security command. Secrets travel only on stdin or stdout, never as
 * arguments, which ps shows to every local user.
 * @param {string[]} args - Arguments, without secrets.
 * @param {string} [input] - Text written to stdin, if any.
 * @returns {Promise<{code: number|null, stdout: string, stderr: string}>} How security exited and what it printed.
 */
function runSecurity(args, input) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn("security", args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", err => reject(new Error(`Could not run security: ${err.message}`)));
    child.on("close", code => resolve({ code, stdout, stderr }));
    if (input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });
}
//
/**
 * Builds the error of a keychain operation, with what security printed.
 * @param {string} action - What failed, such as "read" or "save".
 * @param {string} stderr - What security printed on stderr.
 * @returns {Error} The error.
 */
function keychainError(action, stderr) {
  const detail = stderr.trim();
  return new Error(`Could not ${action} the RDP password in the keychain${detail ? `: ${detail}` : "."}`);
}
//
/**
 * Tells whether a configuration has an RDP password, without extracting the secret.
 * @param {string} configName - Configuration name.
 * @returns {Promise<boolean>} True if the keychain holds one; always false outside macOS.
 * @throws {Error} If the keychain cannot be read.
 */
async function hasRdpPassword(configName) {
  if (!isSupported()) {
    return false;
  }
  const { code, stderr } = await runSecurity(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", keychainAccount(configName)]);
  if (code === 0) {
    return true;
  }
  if (code === ITEM_NOT_FOUND) {
    return false;
  }
  throw keychainError("read", stderr);
}
//
/**
 * Reads the RDP password of a configuration. The keychain holds the base64 of its
 * UTF-8 bytes: with -w, security prints in hex any password that is not printable
 * ASCII, and then a password could not be told from one made of hex digits.
 * @param {string} configName - Configuration name.
 * @returns {Promise<string|null>} The password, or null if there is none; always null outside macOS.
 * @throws {Error} If the keychain cannot be read, or the item was not written by this tool.
 */
async function getRdpPassword(configName) {
  if (!isSupported()) {
    return null;
  }
  const { code, stdout, stderr } = await runSecurity(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", keychainAccount(configName), "-w"]);
  if (code === ITEM_NOT_FOUND) {
    return null;
  }
  if (code !== 0) {
    throw keychainError("read", stderr);
  }
  const encoded = stdout.replace(/\r?\n$/, "");
  if (!BASE64_PATTERN.test(encoded)) {
    throw new Error("The RDP password in the keychain was not written by this tool: set it again with Manage configurations.");
  }
  return Buffer.from(encoded, "base64").toString("utf8");
}
//
/**
 * Saves the RDP password of a configuration in the login keychain, replacing any.
 * The command goes to "security -i" on stdin, with the password as hex of its base64,
 * so it never appears among the arguments of a process. security -i exits with 0 even
 * when the command fails, so a non-empty stderr is a failure; the item is then read
 * back too, since an unchanged password would hide a failed write.
 * @param {string} configName - Configuration name.
 * @param {string} password - Password, as typed.
 * @returns {Promise<void>}
 * @throws {Error} Outside macOS, if the account cannot be quoted, or if the write fails.
 */
async function setRdpPassword(configName, password) {
  if (!isSupported()) {
    throw new Error("RDP passwords can be kept only in the macOS keychain.");
  }
  const account = keychainAccount(configName);
  if (UNQUOTABLE_PATTERN.test(account)) {
    throw new Error(`Cannot save the RDP password: the configuration path "${account}" contains quotes, backslashes or line breaks.`);
  }
  const encoded = Buffer.from(Buffer.from(password, "utf8").toString("base64"), "utf8").toString("hex");
  const command = `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a "${account}" -l "${KEYCHAIN_LABEL}" -j base64 -X ${encoded}\n`;
  const { stderr } = await runSecurity(["-i"], command);
  //
  // Should security ever echo the command, the encoded password stays out of the message.
  if (stderr.trim()) {
    throw keychainError("save", stderr.split(encoded).join("<hidden>"));
  }
  if (await getRdpPassword(configName) !== password) {
    throw new Error("Could not save the RDP password in the keychain: reading it back gave a different value.");
  }
}
//
/**
 * Removes the RDP password of a configuration from the keychain.
 * @param {string} configName - Configuration name.
 * @returns {Promise<boolean>} True if there was one; always false outside macOS.
 * @throws {Error} If the keychain refuses the removal.
 */
async function deleteRdpPassword(configName) {
  if (!isSupported()) {
    return false;
  }
  const { code, stderr } = await runSecurity(["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", keychainAccount(configName)]);
  if (code === 0) {
    return true;
  }
  if (code === ITEM_NOT_FOUND) {
    return false;
  }
  throw keychainError("remove", stderr);
}
//
/**
 * Copies the RDP password of a configuration to another one, for a duplicate.
 * @param {string} fromConfigName - Source configuration.
 * @param {string} toConfigName - New configuration.
 * @returns {Promise<boolean>} True if the source had one; always false outside macOS.
 * @throws {Error} If the keychain cannot be read or written.
 */
async function copyRdpPassword(fromConfigName, toConfigName) {
  if (!isSupported()) {
    return false;
  }
  const password = await getRdpPassword(fromConfigName);
  if (password === null) {
    return false;
  }
  await setRdpPassword(toConfigName, password);
  return true;
}
//
module.exports = {
  KEYCHAIN_SERVICE,
  isSupported,
  hasRdpPassword,
  getRdpPassword,
  setRdpPassword,
  deleteRdpPassword,
  copyRdpPassword
};
