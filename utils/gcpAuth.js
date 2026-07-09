const fs = require("fs");
const { getAdcPath, getCredentialsPath } = require("./paths.js");
const { formatLoginCommand } = require("./gcloud.js");
//
const USER_TYPE = "authorized_user";
const IMPERSONATED_TYPE = "impersonated_service_account";
const SERVICE_ACCOUNT_TYPE = "service_account";
//
/**
 * Extracts the service account email from an impersonation URL.
 * @param {string} url - The service_account_impersonation_url value.
 * @returns {string|null} Service account email, or null if not parseable.
 */
function parseImpersonationUrl(url) {
  if (!url) {
    return null;
  }
  const match = url.match(/serviceAccounts\/([^:/]+)/);
  return match ? match[1] : null;
}
//
/**
 * Tells whether a configuration still authenticates with a static service account key.
 * @param {object} configuration - Loaded configuration object.
 * @returns {boolean} True if the deprecated credentialsFile field is in use.
 */
function isLegacyKeyAuth(configuration) {
  const auth = configuration.auth || {};
  return !auth.identity && Boolean(configuration.credentialsFile);
}
//
/**
 * Overrides the quota project carried by the credentials with the one of the
 * configuration. The credentials of an identity are shared by every configuration
 * that uses it, so their quota_project_id cannot be trusted: whichever
 * configuration was current at login time wrote it. Impersonated credentials bill
 * the service account, so any inherited value is dropped.
 * Note: neither GOOGLE_CLOUD_QUOTA_PROJECT nor clientOptions.quotaProjectId work
 * here, because fromJSON() lets the credentials JSON win (refreshclient.js).
 * @param {object} credentials - Parsed credentials, mutated in place.
 * @param {object} auth - The auth block of the configuration.
 */
function applyQuotaProject(credentials, auth) {
  if (auth.impersonateServiceAccount) {
    delete credentials.quota_project_id;
    return;
  }
  if (auth.quotaProject) {
    credentials.quota_project_id = auth.quotaProject;
  }
}
//
/**
 * Reads and parses a credentials file.
 * @param {string} filePath - Absolute path to the credentials file.
 * @param {string} identity - Identity the file belongs to, used in errors.
 * @returns {object} Parsed credentials.
 * @throws {Error} If the file is not readable JSON.
 */
function readCredentials(filePath, identity) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`The credentials of identity "${identity}" are not readable JSON. Run Login to recreate them.`);
  }
}
//
/**
 * Builds the authentication options for the Google Cloud client libraries.
 * @param {object} configuration - Loaded configuration object.
 * @returns {{credentials?: object, keyFilename?: string, projectId: string}} Options for the GCP clients.
 * @throws {Error} If no credentials are configured or the ADC file is missing.
 */
function buildClientOptions(configuration) {
  const projectId = configuration.defaultProjectId;
  const auth = configuration.auth || {};
  //
  if (auth.identity) {
    const adcPath = getAdcPath(auth.identity);
    if (!fs.existsSync(adcPath)) {
      throw new Error(
        `No credentials for identity "${auth.identity}".\n` +
        `Run the Authentication command and choose Login, or run:\n  ${formatLoginCommand(auth)}`
      );
    }
    const credentials = readCredentials(adcPath, auth.identity);
    applyQuotaProject(credentials, auth);
    return { credentials, projectId };
  }
  //
  if (configuration.credentialsFile) {
    return { keyFilename: getCredentialsPath(configuration.credentialsFile), projectId };
  }
  //
  throw new Error("Configuration has no credentials: set \"auth.identity\" (recommended) or \"credentialsFile\".");
}
//
/**
 * Reads the Application Default Credentials file of an identity.
 * The authorized_user file holds no email: the account must be resolved live.
 * @param {string} identity - Identity name.
 * @returns {{exists: boolean, corrupt: boolean, path: string, type: string|null, quotaProject: string|null, impersonatedServiceAccount: string|null}} Credentials summary.
 */
function readAdcInfo(identity) {
  const adcPath = getAdcPath(identity);
  const info = {
    exists: false,
    corrupt: false,
    path: adcPath,
    type: null,
    quotaProject: null,
    impersonatedServiceAccount: null
  };
  if (!fs.existsSync(adcPath)) {
    return info;
  }
  info.exists = true;
  //
  // An interrupted login can leave a truncated file behind.
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(adcPath, "utf8"));
  } catch {
    info.corrupt = true;
    return info;
  }
  //
  info.type = raw.type || null;
  info.quotaProject = raw.quota_project_id || null;
  info.impersonatedServiceAccount = parseImpersonationUrl(raw.service_account_impersonation_url);
  return info;
}
//
/**
 * Detects a configuration that disagrees with the credentials it points at.
 * Impersonation is baked into the ADC file at login time, so it belongs to the
 * identity: two configurations sharing an identity must agree on it.
 * @param {object} configuration - Loaded configuration object.
 * @returns {string|null} A warning to show the user, or null when consistent.
 */
function describeIdentityMismatch(configuration) {
  const auth = configuration.auth || {};
  if (!auth.identity) {
    return null;
  }
  const info = readAdcInfo(auth.identity);
  if (!info.exists || info.corrupt) {
    return null;
  }
  //
  const wanted = auth.impersonateServiceAccount || null;
  const actual = info.impersonatedServiceAccount;
  if (wanted === actual) {
    return null;
  }
  if (wanted && !actual) {
    return `Identity "${auth.identity}" was logged in without impersonation, but this configuration asks to impersonate ${wanted}. Log in again.`;
  }
  if (!wanted && actual) {
    return `Identity "${auth.identity}" impersonates ${actual}, which this configuration does not ask for. Give it its own identity, or log in again.`;
  }
  return `Identity "${auth.identity}" impersonates ${actual}, but this configuration asks for ${wanted}. Two configurations cannot share an identity with different impersonation targets.`;
}
//
/**
 * Returns a human readable label for an ADC credential type.
 * @param {string|null} type - Credential type read from the ADC file.
 * @returns {string} Description of the credential type.
 */
function describeCredentialType(type) {
  if (type === USER_TYPE) {
    return "user credentials (short-lived access tokens)";
  }
  if (type === IMPERSONATED_TYPE) {
    return "user credentials impersonating a service account";
  }
  if (type === SERVICE_ACCOUNT_TYPE) {
    return "static service account key (deprecated)";
  }
  return type || "unknown";
}
//
/**
 * Turns a GCP authentication failure into an actionable hint.
 * @param {Error} err - The error thrown by a GCP client.
 * @returns {string|null} A hint to show the user, or null if unrelated to auth.
 */
function describeAuthError(err) {
  const message = (err && err.message) || "";
  if (message.includes("invalid_grant") || message.includes("invalid_rapt")) {
    return "The credentials expired or were revoked. Run the Authentication command and choose Login.";
  }
  if (message.includes("x-goog-user-project") || message.includes("quota project") || message.includes("USER_PROJECT_DENIED")) {
    return "User credentials need a quota project. Set \"auth.quotaProject\" in the configuration and log in again.";
  }
  if (message.includes("iam.serviceAccounts.getAccessToken") || message.includes("serviceAccountTokenCreator")) {
    return "Impersonation denied: your account needs roles/iam.serviceAccountTokenCreator on the target service account.";
  }
  if (message.includes("No credentials for identity")) {
    return "Run the Authentication command and choose Login.";
  }
  return null;
}
//
module.exports = {
  isLegacyKeyAuth,
  buildClientOptions,
  readAdcInfo,
  describeIdentityMismatch,
  describeCredentialType,
  describeAuthError
};
