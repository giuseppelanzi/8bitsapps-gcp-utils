const net = require("net");
const path = require("path");
const util = require("util");
const paths = require("./paths.js");
//
// Answer that clears an optional field: an empty answer keeps the default instead.
const CLEAR_MARKER = "-";
//
const PROJECT_PATTERN = /^\S+$/;
const ACCOUNT_PATTERN = /^[^\s@]+@[^\s@]+$/;
const SERVICE_ACCOUNT_PATTERN = /^[^\s@]+@([a-z0-9-]+\.)*gserviceaccount\.com$/i;
const FIREWALL_RULE_PATTERN = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;
const PREFIX_PATTERN = /^(0|[1-9]\d*)$/;
//
// Order of the keys in a written configuration. Keys not listed here follow, in their original order.
const TOP_LEVEL_ORDER = ["auth", "defaultProjectId", "defaultFirewallRule", "defaultFixedIPAddresses", "buckets", "defaultBucket", "ssh"];
const AUTH_ORDER = ["identity", "account", "impersonateServiceAccount", "quotaProject"];
const SSH_ORDER = ["tunnelThroughIap", "keyFile"];
//
// A pair of matching quotes around a whole answer, as left by pasting a quoted path.
const QUOTED_PATTERN = /^(["'])(.*)\1$/s;
//
// A backslash escape, as left by dragging a file from Finder into the terminal.
const ESCAPE_PATTERN = /\\(.)/gs;
//
// --- Answers. ---
//
/**
 * Normalizes a typed answer: trims it and turns the clear marker into an empty string.
 * Used as the filter of every input prompt, so validation already sees the cleared value.
 * @param {string} text - Raw answer.
 * @returns {string} Normalized answer.
 */
function normalizeAnswer(text) {
  const trimmed = String(text ?? "").trim();
  return trimmed === CLEAR_MARKER ? "" : trimmed;
}
//
/**
 * Normalizes a typed key file path, after normalizeAnswer().
 * Removes a pair of quotes around the whole path; outside Windows, an unquoted path
 * also loses its backslash escapes, so a file dragged from Finder works as typed.
 * Windows keeps backslashes, which are its path separator.
 * @param {string} text - Raw answer.
 * @returns {string} Normalized path, or an empty string to clear the field.
 */
function normalizeKeyFileAnswer(text) {
  const answer = normalizeAnswer(text);
  const quoted = QUOTED_PATTERN.exec(answer);
  if (quoted) {
    return quoted[2];
  }
  if (process.platform === "win32") {
    return answer;
  }
  return answer.replace(ESCAPE_PATTERN, "$1");
}
//
/**
 * Splits a list typed as comma or space separated values, dropping duplicates.
 * @param {string} text - Typed list.
 * @returns {string[]} Values in the order typed.
 */
function parseList(text) {
  return [...new Set(String(text ?? "").split(/[\s,]+/).filter(Boolean))];
}
//
/**
 * Normalizes an IP address or CIDR range.
 * An address without a prefix becomes a single host range: /32 for IPv4, /128 for IPv6.
 * @param {string} entry - Address or range.
 * @returns {string|null} The normalized range, or null if invalid.
 */
function normalizeCidr(entry) {
  const parts = String(entry).split("/");
  if (parts.length > 2) {
    return null;
  }
  const [address, prefix] = parts;
  const version = net.isIP(address);
  if (version === 0) {
    return null;
  }
  const maxPrefix = version === 4 ? 32 : 128;
  if (prefix === undefined) {
    return `${address}/${maxPrefix}`;
  }
  if (!PREFIX_PATTERN.test(prefix) || Number(prefix) > maxPrefix) {
    return null;
  }
  return `${address}/${prefix}`;
}
//
// --- Validators: true, or the message to show. ---
//
/**
 * Tells whether a name is taken, ignoring case: on macOS and Windows the file system
 * does, so "Prod" and "prod" would end up as the same file or directory.
 * @param {string[]} names - Names already taken.
 * @param {string} value - Candidate name.
 * @returns {boolean} True if a name differing only in case exists.
 */
function isNameTaken(names, value) {
  return findName(names, value) !== undefined;
}
//
/**
 * Finds the name that matches a value ignoring case.
 * @param {string[]} names - Existing names.
 * @param {string} value - Name looked for.
 * @returns {string|undefined} The existing name as spelled, or undefined.
 */
function findName(names, value) {
  const wanted = String(value).toLowerCase();
  return names.find(name => name.toLowerCase() === wanted);
}
//
/**
 * Builds the validator of a new configuration name.
 * @param {string[]} existingNames - Names already taken.
 * @returns {function(string): (true|string)} Validator.
 */
function validateConfigName(existingNames) {
  return value => {
    if (!paths.isValidName(value)) {
      return "Use letters, digits, dot, dash or underscore.";
    }
    if (isNameTaken(existingNames, value)) {
      return `Configuration "${value}" already exists.`;
    }
    return true;
  };
}
//
/**
 * Validates an identity name. A name already known is accepted: the wizard then
 * uses that identity, as spelled, instead of creating a second one.
 * @param {string} value - Answer.
 * @returns {true|string} True, or the message to show.
 */
function validateIdentityName(value) {
  return paths.isValidName(value) || "Use letters, digits, dot, dash or underscore.";
}
//
/**
 * Validates a required project ID.
 * @param {string} value - Answer.
 * @returns {true|string} True, or the message to show.
 */
function validateProjectId(value) {
  if (!value) {
    return "The project ID is required.";
  }
  return PROJECT_PATTERN.test(value) || "The project ID cannot contain spaces.";
}
//
/**
 * Validates an optional project ID.
 * @param {string} value - Answer.
 * @returns {true|string} True, or the message to show.
 */
function validateOptionalProjectId(value) {
  return !value || PROJECT_PATTERN.test(value) || "The project ID cannot contain spaces.";
}
//
/**
 * Validates an optional Google account.
 * @param {string} value - Answer.
 * @returns {true|string} True, or the message to show.
 */
function validateAccount(value) {
  return !value || ACCOUNT_PATTERN.test(value) || "Enter an email address, or \"-\" to clear.";
}
//
/**
 * Validates an optional service account.
 * @param {string} value - Answer.
 * @returns {true|string} True, or the message to show.
 */
function validateServiceAccount(value) {
  return !value || SERVICE_ACCOUNT_PATTERN.test(value) || "Enter a service account (…@….gserviceaccount.com), or \"-\" to clear.";
}
//
/**
 * Validates an optional firewall rule name.
 * @param {string} value - Answer.
 * @returns {true|string} True, or the message to show.
 */
function validateFirewallRule(value) {
  return !value || FIREWALL_RULE_PATTERN.test(value) || "Use lowercase letters, digits and dashes, starting with a letter.";
}
//
/**
 * Validates a list of bucket names.
 * @param {string} value - Typed list.
 * @returns {true|string} True, or the message to show.
 */
function validateBucketList(value) {
  const invalid = parseList(value).filter(name => !BUCKET_PATTERN.test(name));
  return invalid.length === 0 || `Invalid bucket name: ${invalid.join(", ")}.`;
}
//
/**
 * Validates a list of IP addresses or CIDR ranges.
 * @param {string} value - Typed list.
 * @returns {true|string} True, or the message to show.
 */
function validateCidrList(value) {
  const invalid = parseList(value).filter(entry => normalizeCidr(entry) === null);
  return invalid.length === 0 || `Invalid address or range: ${invalid.join(", ")}.`;
}
//
/**
 * Validates an optional private key path. Only the form is checked here: whether
 * the files exist is gcloud.describeSshKeyProblem()'s job, and only a warning.
 * @param {string} value - Answer, already normalized.
 * @returns {true|string} True, or the message to show.
 */
function validateKeyFile(value) {
  if (!value) {
    return true;
  }
  if (value === "~" || /[\\/]$/.test(value)) {
    return "Enter the private key file, not a folder, or \"-\" to clear.";
  }
  if (value.endsWith(".pub")) {
    return "Enter the private key, not the .pub file next to it, or \"-\" to clear.";
  }
  return path.isAbsolute(paths.expandHome(value)) || "Enter an absolute path, or one starting with ~/, or \"-\" to clear.";
}
//
// --- Reading a configuration. ---
//
/**
 * Reads a string field, treating anything else as empty.
 * @param {*} value - Field value.
 * @returns {string} The string, or an empty string.
 */
function asText(value) {
  return typeof value === "string" ? value : "";
}
//
/**
 * Returns the bucket names of a configuration, whether stored as strings or objects.
 * @param {object} configuration - Configuration object.
 * @returns {string[]} Bucket names.
 */
function bucketNames(configuration) {
  const buckets = Array.isArray(configuration.buckets) ? configuration.buckets : [];
  return buckets.map(b => (typeof b === "string" ? b : asText(b && b.name))).filter(Boolean);
}
//
/**
 * Returns the buckets the Storage Navigator actually offers: the buckets list,
 * or defaultBucket when the list is empty (see Storage.getBuckets()).
 * @param {object} configuration - Configuration object.
 * @returns {string[]} Effective bucket names.
 */
function effectiveBuckets(configuration) {
  const names = bucketNames(configuration);
  if (names.length === 0 && asText(configuration.defaultBucket)) {
    return [configuration.defaultBucket];
  }
  return names;
}
//
/**
 * Returns the fixed IP ranges of a configuration, normalized where possible.
 * @param {object} configuration - Configuration object.
 * @returns {string[]} Ranges.
 */
function fixedRanges(configuration) {
  const ranges = Array.isArray(configuration.defaultFixedIPAddresses) ? configuration.defaultFixedIPAddresses : [];
  return ranges.map(entry => normalizeCidr(entry) || String(entry));
}
//
/**
 * Tells whether a configuration reaches its VMs through IAP.
 * @param {object} configuration - Configuration object.
 * @returns {boolean} The effective ssh.tunnelThroughIap value.
 */
function tunnelsThroughIap(configuration) {
  return Boolean(configuration.ssh && configuration.ssh.tunnelThroughIap);
}
//
/**
 * Returns the private key a configuration hands to gcloud compute ssh.
 * @param {object} configuration - Configuration object.
 * @returns {string} The ssh.keyFile value as written, or an empty string for gcloud's default.
 */
function sshKeyFile(configuration) {
  return asText((configuration.ssh || {}).keyFile);
}
//
// --- Building a configuration. ---
//
/**
 * Applies a string answer, keeping the original representation when the value did not change.
 * @param {object} target - Object to update, already a copy of the original.
 * @param {string} key - Field name.
 * @param {string} answer - New value; empty removes the field.
 */
function applyText(target, key, answer) {
  if (asText(target[key]) === answer) {
    return;
  }
  if (answer) {
    target[key] = answer;
  } else {
    delete target[key];
  }
}
//
/**
 * Applies the bucket answer. Existing buckets keep their form, string or object;
 * new ones are strings. defaultBucket stays while it is still in the list, and is
 * dropped once it is not: it would otherwise keep showing up in the Storage
 * Navigator, as the fallback of an empty list, without the wizard showing it.
 * @param {object} target - Configuration copy to update.
 * @param {string[]} names - Bucket names answered.
 */
function applyBuckets(target, names) {
  if (util.isDeepStrictEqual(effectiveBuckets(target), names)) {
    return;
  }
  const existing = Array.isArray(target.buckets) ? target.buckets : [];
  const byName = new Map(existing.map(b => [typeof b === "string" ? b : asText(b && b.name), b]));
  if (names.length > 0) {
    target.buckets = names.map(name => (byName.has(name) ? byName.get(name) : name));
  } else {
    delete target.buckets;
  }
  if (!names.includes(target.defaultBucket)) {
    delete target.defaultBucket;
  }
}
//
/**
 * Copies an object with its keys in a canonical order, unknown keys last in their original order.
 * @param {object} source - Object to reorder.
 * @param {string[]} order - Canonical key order.
 * @returns {object} Reordered copy.
 */
function orderKeys(source, order) {
  const ordered = {};
  for (const key of order) {
    if (Object.hasOwn(source, key)) {
      ordered[key] = source[key];
    }
  }
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(ordered, key)) {
      ordered[key] = source[key];
    }
  }
  return ordered;
}
//
/**
 * Builds the configuration to save from the original one and the wizard answers.
 * A field whose answer equals its original value keeps its original representation:
 * an absent key stays absent, [] stays [], "" stays "". Keys the wizard does not
 * manage are kept as they are.
 * @param {object} original - Configuration being edited or duplicated, {} for a new one.
 * @param {{defaultProjectId: string, identity: string, account: string, impersonateServiceAccount: string, quotaProject?: string, buckets: string[], defaultFirewallRule: string, fixedIPAddresses: string[], tunnelThroughIap: boolean, keyFile: string, removeCredentialsFile?: boolean}} answers - Wizard answers; quotaProject is undefined when not asked.
 * @returns {object} The configuration to save.
 */
function buildConfiguration(original, answers) {
  const result = structuredClone(original);
  const auth = result.auth && typeof result.auth === "object" ? result.auth : {};
  //
  applyText(auth, "identity", answers.identity);
  applyText(auth, "account", answers.account);
  applyText(auth, "impersonateServiceAccount", answers.impersonateServiceAccount);
  if (answers.quotaProject !== undefined) {
    applyText(auth, "quotaProject", answers.quotaProject);
  }
  result.auth = orderKeys(auth, AUTH_ORDER);
  //
  applyText(result, "defaultProjectId", answers.defaultProjectId);
  applyText(result, "defaultFirewallRule", answers.defaultFirewallRule);
  if (!util.isDeepStrictEqual(fixedRanges(result), answers.fixedIPAddresses)) {
    if (answers.fixedIPAddresses.length > 0) {
      result.defaultFixedIPAddresses = answers.fixedIPAddresses;
    } else {
      delete result.defaultFixedIPAddresses;
    }
  }
  applyBuckets(result, answers.buckets);
  if (tunnelsThroughIap(result) !== answers.tunnelThroughIap) {
    const ssh = result.ssh && typeof result.ssh === "object" ? result.ssh : {};
    ssh.tunnelThroughIap = answers.tunnelThroughIap;
    result.ssh = ssh;
  }
  //
  // A block left empty by clearing keyFile goes away: an absent block means the defaults too.
  if (sshKeyFile(result) !== answers.keyFile) {
    const ssh = result.ssh && typeof result.ssh === "object" ? result.ssh : {};
    applyText(ssh, "keyFile", answers.keyFile);
    if (Object.keys(ssh).length > 0) {
      result.ssh = ssh;
    } else {
      delete result.ssh;
    }
  }
  if (result.ssh && typeof result.ssh === "object") {
    result.ssh = orderKeys(result.ssh, SSH_ORDER);
  }
  if (answers.removeCredentialsFile) {
    delete result.credentialsFile;
  }
  //
  return orderKeys(result, TOP_LEVEL_ORDER);
}
//
// --- Identities. ---
//
/**
 * Finds the other configurations that share an identity but disagree on how to log in.
 * The account and the impersonation are written into the credentials at login time,
 * so a login for one configuration switches every other one using the identity.
 * Accounts are compared only when both are set, ignoring case.
 * @param {Map} identities - Result of configLoader.listIdentities().
 * @param {string} identity - Identity chosen.
 * @param {{account: string, impersonateServiceAccount: string}} wanted - Values chosen, empty for none.
 * @param {string|null} selfName - Configuration being edited, excluded from the check.
 * @returns {Array<{name: string, account: string, impersonateServiceAccount: string}>} Conflicting configurations.
 */
function findIdentityConflicts(identities, identity, wanted, selfName) {
  const entry = identities.get(identity);
  if (!entry) {
    return [];
  }
  const account = (wanted.account || "").toLowerCase();
  const impersonation = wanted.impersonateServiceAccount || "";
  return entry.configs.filter(c => {
    if (c.name === selfName) {
      return false;
    }
    const otherAccount = c.account.toLowerCase();
    return c.impersonateServiceAccount !== impersonation || Boolean(account && otherAccount && account !== otherAccount);
  });
}
//
/**
 * Returns the auth values another configuration uses with an identity.
 * @param {Map} identities - Result of configLoader.listIdentities().
 * @param {string} identity - Identity chosen.
 * @param {string|null} selfName - Configuration being edited, excluded.
 * @returns {{account: string, impersonateServiceAccount: string}|null} Values, or null when no other configuration uses it.
 */
function siblingAuthDefaults(identities, identity, selfName) {
  const entry = identities.get(identity);
  const others = entry ? entry.configs.filter(c => c.name !== selfName) : [];
  const sibling = others.find(c => c.account) || others[0];
  if (!sibling) {
    return null;
  }
  return { account: sibling.account, impersonateServiceAccount: sibling.impersonateServiceAccount };
}
//
// --- Summary. ---
//
/**
 * The fields shown in the summary, with how to read each one as text.
 */
const SUMMARY_FIELDS = [
  { label: "Project ID", read: c => asText(c.defaultProjectId) },
  { label: "Identity", read: c => asText((c.auth || {}).identity) },
  { label: "Account", read: c => asText((c.auth || {}).account) },
  { label: "Impersonate", read: c => asText((c.auth || {}).impersonateServiceAccount) },
  { label: "Quota project", read: c => asText((c.auth || {}).quotaProject) },
  { label: "Buckets", read: c => bucketNames(c).join(", ") },
  { label: "Default bucket", read: c => asText(c.defaultBucket) },
  { label: "Firewall rule", read: c => asText(c.defaultFirewallRule) },
  { label: "Fixed IPs", read: c => fixedRanges(c).join(", ") },
  { label: "SSH via IAP", read: c => (tunnelsThroughIap(c) ? "yes" : "no") },
  { label: "SSH key", read: sshKeyFile },
  { label: "Credentials file", read: c => asText(c.credentialsFile) }
];
//
/**
 * Describes a configuration field by field.
 * Fields that are empty in both are left out of a comparison.
 * @param {object} updated - Configuration to describe.
 * @param {object} [original] - Configuration to compare with.
 * @returns {Array<{label: string, value: string, before: string, changed: boolean}>} One row per field.
 */
function describeFields(updated, original) {
  const base = original || updated;
  return SUMMARY_FIELDS
    .map(field => {
      const value = field.read(updated);
      const before = field.read(base);
      return { label: field.label, value, before, changed: value !== before };
    })
    .filter(row => row.value || row.before);
}
//
module.exports = {
  normalizeAnswer,
  normalizeKeyFileAnswer,
  parseList,
  normalizeCidr,
  validateConfigName,
  validateIdentityName,
  validateProjectId,
  validateOptionalProjectId,
  validateAccount,
  validateServiceAccount,
  validateFirewallRule,
  validateBucketList,
  validateCidrList,
  validateKeyFile,
  isNameTaken,
  findName,
  asText,
  bucketNames,
  effectiveBuckets,
  fixedRanges,
  tunnelsThroughIap,
  sshKeyFile,
  buildConfiguration,
  findIdentityConflicts,
  siblingAuthDefaults,
  describeFields
};
