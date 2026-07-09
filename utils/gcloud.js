const childProcess = require("child_process");
const fs = require("fs/promises");
const axios = require("axios");
const { getGcloudDir } = require("./paths.js");
//
const TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const GCLOUD_MISSING = "gcloud is not installed or not in PATH. Install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install";
const NO_FILE_LOGGING = "CLOUDSDK_CORE_DISABLE_FILE_LOGGING";
const MODE_CAPTURE = "capture";
const MODE_FILTER = "filter";
//
// Notices gcloud prints on stderr after a login. They describe the machine-wide ADC,
// which this tool never writes: every identity keeps its credentials under its own
// CLOUDSDK_CONFIG, and buildClientOptions() passes them explicitly rather than relying
// on ADC discovery. The quota project notice is inaccurate for the same reason, because
// applyQuotaProject() overrides quota_project_id with the value of the configuration.
const ADC_NOTICES = [
  /^Credentials saved to file: \[.*\]$/,
  /^These credentials will be used by any library that requests Application Default Credentials \(ADC\)\.$/,
  /^Quota project ".*" was added to ADC which can be used by Google client libraries/
];
//
/**
 * Builds the gcloud arguments that create the credentials of an identity.
 * Single source of truth for both the executed command and the printed hint.
 * @param {{identity: string, account?: string, impersonateServiceAccount?: string}} auth - Auth block of a configuration.
 * @returns {string[]} Arguments for gcloud.
 */
function buildLoginArgs(auth) {
  const args = ["auth", "application-default", "login"];
  if (auth.account) {
    args.push(auth.account);
  }
  if (auth.impersonateServiceAccount) {
    args.push(`--impersonate-service-account=${auth.impersonateServiceAccount}`);
  }
  return args;
}
//
/**
 * Renders the login command as the user would type it in a shell.
 * Carries the same environment as runGcloud(), so a hand-run login does not
 * write the refresh token to a log file either.
 * @param {object} auth - Auth block of a configuration.
 * @returns {string} The equivalent shell command.
 */
function formatLoginCommand(auth) {
  return `CLOUDSDK_CONFIG="${getGcloudDir(auth.identity)}" ${NO_FILE_LOGGING}=1 gcloud ${buildLoginArgs(auth).join(" ")}`;
}
//
/**
 * Streams gcloud stderr to the terminal, dropping the notices of ADC_NOTICES.
 * A blank line is held back until the following line is known, so suppressing a
 * notice does not leave the empty line that preceded it behind.
 * @returns {{push: function(string): void, flush: function(): void}} A line filter.
 */
function createNoticeFilter() {
  let buffer = "";
  let blankHeld = false;
  //
  function emit(line) {
    if (ADC_NOTICES.some(pattern => pattern.test(line))) {
      blankHeld = false;
      return;
    }
    if (line === "") {
      blankHeld = true;
      return;
    }
    if (blankHeld) {
      process.stderr.write("\n");
      blankHeld = false;
    }
    process.stderr.write(`${line}\n`);
  }
  //
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        emit(line);
      }
    },
    flush() {
      if (buffer) {
        emit(buffer);
        buffer = "";
      }
      if (blankHeld) {
        process.stderr.write("\n");
        blankHeld = false;
      }
    }
  };
}
//
/**
 * Maps a run mode to the stdio configuration of the child process.
 * Only MODE_FILTER pipes stderr: stdin and stdout stay inherited, so the tty
 * detection and the interactive prompts of gcloud are unaffected.
 * @param {string} mode - MODE_CAPTURE or MODE_FILTER; anything else inherits every stream.
 * @returns {string|string[]} The stdio option for spawn().
 */
function stdioForMode(mode) {
  if (mode === MODE_CAPTURE) {
    return ["ignore", "pipe", "pipe"];
  }
  if (mode === MODE_FILTER) {
    return ["inherit", "inherit", "pipe"];
  }
  return "inherit";
}
//
/**
 * Runs gcloud inside the identity's own configuration directory.
 * The user's global gcloud configuration is never read nor written.
 * @param {string[]} args - Arguments passed to gcloud.
 * @param {string} identity - Identity name.
 * @param {string} mode - MODE_CAPTURE to capture stdout, MODE_FILTER to filter stderr.
 * @returns {Promise<string>} Captured stdout, or an empty string.
 */
function runGcloud(args, identity, mode) {
  return new Promise((resolve, reject) => {
    // gcloud writes DEBUG logs under CLOUDSDK_CONFIG/logs, and the login flow records
    // the OAuth refresh token there in cleartext. Disabling file logging still lets
    // gcloud garbage collect the log directories already on disk.
    const child = childProcess.spawn("gcloud", args, {
      stdio: stdioForMode(mode),
      env: {
        ...process.env,
        CLOUDSDK_CONFIG: getGcloudDir(identity),
        [NO_FILE_LOGGING]: "1"
      }
    });
    let stdout = "";
    let stderr = "";
    const filter = mode === MODE_FILTER ? createNoticeFilter() : null;
    if (mode === MODE_CAPTURE) {
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
    }
    // The raw stderr is kept as well, so a failure still reports what gcloud said.
    if (filter) {
      child.stderr.on("data", chunk => {
        stderr += chunk;
        filter.push(chunk.toString());
      });
    }
    child.on("error", err => {
      reject(err.code === "ENOENT" ? new Error(GCLOUD_MISSING) : err);
    });
    child.on("close", code => {
      if (filter) {
        filter.flush();
      }
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `gcloud exited with code ${code}.`));
    });
  });
}
//
/**
 * Runs the interactive ADC login for an identity.
 * @param {object} auth - Auth block of a configuration.
 * @returns {Promise<void>}
 */
async function loginAdc(auth) {
  await fs.mkdir(getGcloudDir(auth.identity), { recursive: true });
  await runGcloud(buildLoginArgs(auth), auth.identity, MODE_FILTER);
}
//
/**
 * Revokes the stored credentials of an identity.
 * @param {string} identity - Identity name.
 * @returns {Promise<void>}
 */
async function revokeAdc(identity) {
  await runGcloud(["auth", "application-default", "revoke", "--quiet"], identity, MODE_CAPTURE);
}
//
/**
 * Resolves which account the stored credentials currently act as.
 * The access token stays in memory: it is never printed nor attached to a thrown error.
 * @param {string} identity - Identity name.
 * @returns {Promise<string>} The account email, or a best-effort identifier.
 */
async function resolveActiveAccount(identity) {
  const accessToken = await runGcloud(["auth", "application-default", "print-access-token"], identity, MODE_CAPTURE);
  try {
    const response = await axios.get(TOKEN_INFO_URL, { params: { access_token: accessToken } });
    return response.data.email || response.data.sub || "unknown";
  } catch {
    throw new Error("The token info endpoint did not recognize the credentials.");
  }
}
//
module.exports = {
  buildLoginArgs,
  formatLoginCommand,
  loginAdc,
  revokeAdc,
  resolveActiveAccount
};
