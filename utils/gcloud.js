const childProcess = require("child_process");
const fs = require("fs/promises");
const axios = require("axios");
const { getGcloudDir, getAdcPath } = require("./paths.js");
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
// Inherited gcloud variables that decide who a command runs as, or who is billed.
// An SSH session must run as the identity of the configuration, not as the shell's.
const IDENTITY_ENV_PATTERN = /^CLOUDSDK_(AUTH_|BILLING_|CORE_ACCOUNT$)/;
//
/**
 * Builds the variables that confine gcloud to the identity's own configuration directory.
 * gcloud writes DEBUG logs under CLOUDSDK_CONFIG/logs, and the login flow records
 * the OAuth refresh token there in cleartext. Disabling file logging still lets
 * gcloud garbage collect the log directories already on disk.
 * @param {string} identity - Identity name.
 * @returns {object} The CLOUDSDK_CONFIG and file logging variables.
 */
function baseGcloudEnv(identity) {
  return {
    CLOUDSDK_CONFIG: getGcloudDir(identity),
    [NO_FILE_LOGGING]: "1"
  };
}
//
/**
 * Renders environment variables as shell assignments.
 * Values are double quoted, because the configuration directory may contain spaces.
 * @param {object} env - Variables to render.
 * @returns {string} The assignments, space separated.
 */
function formatEnv(env) {
  return Object.entries(env).map(([name, value]) => `${name}="${value}"`).join(" ");
}
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
  return `${formatEnv(baseGcloudEnv(auth.identity))} gcloud ${buildLoginArgs(auth).join(" ")}`;
}
//
/**
 * Builds the gcloud arguments that open an SSH session on a VM instance.
 * Single source of truth for both the executed command and the printed hint.
 * @param {{instance: string, projectId: string, zone: string, tunnelThroughIap: boolean}} session - SSH session.
 * @returns {string[]} Arguments for gcloud.
 */
function buildSshArgs(session) {
  const args = ["compute", "ssh", session.instance, `--project=${session.projectId}`, `--zone=${session.zone}`];
  if (session.tunnelThroughIap) {
    args.push("--tunnel-through-iap");
  }
  return args;
}
//
/**
 * Builds the environment that runs gcloud as the identity of an SSH session.
 * The identity directory holds only the ADC file, not credentials of gcloud's own,
 * so the file reaches gcloud through the credential file override. The override
 * leaves core/account empty, while OS Login reads the user from it: it is set too.
 * auth/impersonate_service_account is never set, because an impersonated ADC file
 * already acts as the service account and gcloud would impersonate it twice.
 * @param {{identity: string, account: string, quotaProject: string|null}} session - SSH session.
 * @returns {object} The CLOUDSDK_* variables only, without the inherited environment.
 */
function buildSshEnv(session) {
  const env = {
    ...baseGcloudEnv(session.identity),
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: getAdcPath(session.identity),
    CLOUDSDK_CORE_ACCOUNT: session.account
  };
  if (session.quotaProject) {
    env.CLOUDSDK_BILLING_QUOTA_PROJECT = session.quotaProject;
  }
  return env;
}
//
/**
 * Renders the SSH command as the user would type it in a shell.
 * @param {object} session - SSH session, see buildSshArgs() and buildSshEnv().
 * @returns {string} The equivalent shell command.
 */
function formatSshCommand(session) {
  return `${formatEnv(buildSshEnv(session))} gcloud ${buildSshArgs(session).join(" ")}`;
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
    const child = childProcess.spawn("gcloud", args, {
      stdio: stdioForMode(mode),
      env: { ...process.env, ...baseGcloudEnv(identity) }
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
/**
 * Copies the inherited environment without the gcloud variables of IDENTITY_ENV_PATTERN.
 * A CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT exported in the shell, for instance,
 * would make gcloud impersonate on top of the ADC file. Settings such as
 * CLOUDSDK_PYTHON are kept.
 * @returns {object} The filtered environment.
 */
function inheritedEnvWithoutIdentity() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !IDENTITY_ENV_PATTERN.test(name)));
}
//
/**
 * Opens an interactive SSH session through gcloud compute ssh.
 * The child owns the terminal until it exits. Ctrl+C reaches it through the tty,
 * so this process ignores SIGINT meanwhile instead of quitting the whole tool.
 * @param {object} session - SSH session, see buildSshArgs() and buildSshEnv().
 * @returns {Promise<{code: number|null, signal: string|null}>} How gcloud exited.
 */
function runComputeSsh(session) {
  return new Promise((resolve, reject) => {
    const ignoreInterrupt = () => {};
    const cleanup = () => process.removeListener("SIGINT", ignoreInterrupt);
    process.on("SIGINT", ignoreInterrupt);
    const child = childProcess.spawn("gcloud", buildSshArgs(session), {
      stdio: "inherit",
      env: { ...inheritedEnvWithoutIdentity(), ...buildSshEnv(session) }
    });
    child.on("error", err => {
      cleanup();
      reject(err.code === "ENOENT" ? new Error(GCLOUD_MISSING) : err);
    });
    child.on("close", (code, signal) => {
      cleanup();
      resolve({ code, signal });
    });
  });
}
//
module.exports = {
  buildLoginArgs,
  formatLoginCommand,
  buildSshArgs,
  buildSshEnv,
  formatSshCommand,
  loginAdc,
  revokeAdc,
  resolveActiveAccount,
  runComputeSsh
};
