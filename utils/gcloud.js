const childProcess = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const axios = require("axios");
const crossSpawn = require("cross-spawn");
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
// An argument a POSIX shell reads as it is, with no quoting.
const SAFE_ARG_PATTERN = /^[A-Za-z0-9_@%+=:,./-]+$/;
//
// A --flag=value argument, split on its first "=" only: a path may contain more.
const FLAG_VALUE_PATTERN = /^(--[a-z-]+=)(.*)$/s;
//
// First line of an OpenSSH public key: key type, then the base64 blob. The type
// also covers the hardware key types, such as sk-ssh-ed25519@openssh.com.
const OPENSSH_PUBLIC_KEY_PATTERN = /^(ssh-|ecdsa-|sk-)\S+\s+[A-Za-z0-9+/]+={0,2}(\s|$)/;
//
// The line gcloud start-iap-tunnel prints once its local port accepts connections.
const TUNNEL_PORT_PATTERN = /Listening on port \[(\d+)\]/;
//
// How long an IAP tunnel may take to print its port, before it is given up.
const TUNNEL_START_TIMEOUT_MS = 30000;
//
// How long a tunnel may take to exit after SIGTERM, before it is killed.
const TUNNEL_KILL_GRACE_MS = 5000;
//
// Output kept while looking for the port line, and stderr kept for the error of a failed tunnel.
const TUNNEL_SCAN_CHARS = 1000;
const TUNNEL_STDERR_CHARS = 8000;
const TUNNEL_STDERR_LINES = 20;
//
// Destination of the commands sent through the control socket of a master connection.
// ssh demands one even for -O commands; the master ignores it.
const CONTROL_HOST = "gcp-utils";
//
// How long a master connection may take to open, a passphrase or a 2FA prompt included.
const MASTER_START_TIMEOUT_MS = 120000;
//
// How often the control socket is looked for while the master connection opens.
const MASTER_POLL_MS = 200;
//
// How long gcloud may take to exit once its master connection was told to exit,
// and how long its output may still arrive once it has exited.
const MASTER_EXIT_GRACE_MS = 5000;
const MASTER_OUTPUT_GRACE_MS = 1000;
//
// How often the processes of a master connection are looked for while they terminate.
const PROCESS_POLL_MS = 100;
//
// How long a -O command may take before it is killed: a master that stopped answering
// must not hang the opening or the closing.
const CONTROL_COMMAND_TIMEOUT_MS = 10000;
//
// Characters that a POSIX extended regular expression, as pkill -f reads it, treats as special.
const REGEX_SPECIAL_PATTERN = /[.*+?^${}()|[\]\\]/g;
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
 * Double quotes a value for a POSIX shell, escaping what stays special inside quotes.
 * On Windows backslashes are path separators and are left as they are.
 * @param {string} value - Value to quote.
 * @returns {string} The quoted value.
 */
function quoteShellValue(value) {
  const special = process.platform === "win32" ? /["$`]/g : /["$`\\]/g;
  return `"${String(value).replace(special, "\\$&")}"`;
}
//
/**
 * Renders an argument as the user would type it in a shell.
 * Only arguments that need it are quoted; of a --flag=value argument, only the value.
 * @param {string} arg - Argument passed to gcloud.
 * @returns {string} The argument, quoted if needed.
 */
function formatShellArg(arg) {
  if (SAFE_ARG_PATTERN.test(arg)) {
    return arg;
  }
  const flag = FLAG_VALUE_PATTERN.exec(arg);
  if (flag) {
    return `${flag[1]}${quoteShellValue(flag[2])}`;
  }
  return quoteShellValue(arg);
}
//
/**
 * Renders environment variables as shell assignments.
 * Values are always double quoted, because the configuration directory may contain spaces.
 * @param {object} env - Variables to render.
 * @returns {string} The assignments, space separated.
 */
function formatEnv(env) {
  return Object.entries(env).map(([name, value]) => `${name}=${quoteShellValue(value)}`).join(" ");
}
//
/**
 * Starts gcloud. On Windows gcloud is gcloud.cmd, which spawn() does not find, since it
 * looks for .exe and .com only: cross-spawn resolves it through PATHEXT and runs it
 * through cmd.exe, escaping the arguments once. That is enough for the arguments the
 * tool passes, which never carry ", %, ! or ^. Elsewhere it is spawn() itself.
 * @param {string[]} args - Arguments for gcloud.
 * @param {object} options - Options for spawn().
 * @returns {ChildProcess} The child process.
 */
function spawnGcloud(args, options) {
  return crossSpawn("gcloud", args, options);
}
//
/**
 * Resolves after a promise settles, or after a time limit, whichever comes first.
 * @param {Promise} promise - Promise to wait for.
 * @param {number} ms - Time limit.
 * @returns {Promise<boolean>} True if the promise settled in time.
 */
function settlesWithin(promise, ms) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), ms);
    promise.then(() => {
      clearTimeout(timer);
      resolve(true);
    }, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
//
/**
 * Stops a child process and waits for it to exit.
 * On Windows a gcloud started through cmd.exe is a tree, and kill() would end cmd.exe
 * only: taskkill ends the whole tree. Elsewhere SIGTERM. Either way SIGKILL follows
 * after TUNNEL_KILL_GRACE_MS if the child is still running.
 * @param {ChildProcess} child - Child process.
 * @param {Promise} exited - Resolves once the child has exited.
 * @returns {Promise<void>}
 */
async function stopChild(child, exited) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
    await exited;
    return;
  }
  if (process.platform === "win32") {
    const killer = childProcess.spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.on("error", () => {});
  } else {
    child.kill("SIGTERM");
  }
  const killTimer = setTimeout(() => child.kill("SIGKILL"), TUNNEL_KILL_GRACE_MS);
  await exited;
  clearTimeout(killTimer);
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
 * Without sshKeyFile, gcloud uses its own key pair, ~/.ssh/google_compute_engine.
 * With it, gcloud is told never to regenerate the pair: a key it finds broken would
 * otherwise be overwritten on a single confirmation, and it is the user's own key.
 * @param {{instance: string, projectId: string, zone: string, tunnelThroughIap: boolean, sshKeyFile: string|null}} session - SSH session.
 * @returns {string[]} Arguments for gcloud.
 */
function buildSshArgs(session) {
  return ["compute", "ssh", session.instance, ...buildConnectionFlags(session)];
}
//
/**
 * Builds the flags that say where and how gcloud reaches a VM, shared by compute ssh
 * and compute scp: project, zone, IAP, and the key pair, never regenerated when it is
 * the user's own.
 * @param {{projectId: string, zone: string, tunnelThroughIap: boolean, sshKeyFile: string|null}} session - SSH session.
 * @returns {string[]} Flags for gcloud.
 */
function buildConnectionFlags(session) {
  const flags = [`--project=${session.projectId}`, `--zone=${session.zone}`];
  if (session.tunnelThroughIap) {
    flags.push("--tunnel-through-iap");
  }
  if (session.sshKeyFile) {
    flags.push(`--ssh-key-file=${session.sshKeyFile}`, "--no-force-key-file-overwrite");
  }
  return flags;
}
//
/**
 * Returns the private key gcloud uses when no ssh.keyFile is set.
 * @returns {string} The path of ~/.ssh/google_compute_engine.
 */
function defaultSshKeyFile() {
  return path.join(os.homedir(), ".ssh", "google_compute_engine");
}
//
/**
 * Builds the gcloud arguments that run one command on a VM instance and return.
 * @param {object} session - SSH session, see buildSshArgs().
 * @param {string} command - Remote command, run by the login shell of the remote user.
 * @returns {string[]} Arguments for gcloud.
 */
function buildRemoteCommandArgs(session, command) {
  return [...buildSshArgs(session), `--command=${command}`];
}
//
/**
 * Builds the gcloud arguments that copy one file to or from a VM instance.
 * Single source of truth for both the executed command and the printed hint. The local
 * file is relative to the working directory, so a drive letter or a ":" in its name is
 * never taken for an instance.
 * @param {object} session - SSH session, see buildSshArgs().
 * @param {{direction: string, remotePath: string, localName: string}} transfer - "download" or "upload", the absolute remote path, and the local file name.
 * @returns {string[]} Arguments for gcloud.
 */
function buildScpArgs(session, transfer) {
  const remote = `${session.instance}:${transfer.remotePath}`;
  const local = `.${path.sep}${transfer.localName}`;
  const [source, destination] = transfer.direction === "download" ? [remote, local] : [local, remote];
  return ["compute", "scp", source, destination, ...buildConnectionFlags(session)];
}
//
/**
 * Builds the gcloud arguments that open a master connection: an SSH connection with no
 * remote command, whose control socket later commands go through. The ssh options come
 * after "--", since gcloud splits the values of --ssh-flag on spaces. gcloud is always
 * told never to regenerate the key pair: with stdin closed it would do it unasked.
 * @param {object} session - SSH session, see buildSshArgs().
 * @param {string} controlPath - Path of the control socket.
 * @returns {string[]} Arguments for gcloud.
 */
function buildSshMasterArgs(session, controlPath) {
  const args = buildSshArgs(session);
  if (!session.sshKeyFile) {
    args.push("--no-force-key-file-overwrite");
  }
  args.push(
    "--",
    "-N",
    "-o", "ControlMaster=yes",
    "-o", `ControlPath=${controlPath}`,
    "-o", "ControlPersist=no",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "ConnectTimeout=20"
  );
  return args;
}
//
/**
 * Builds the ssh options that send a command through the control socket of a master
 * connection, for ssh and sftp alike. The socket is always given with -o ControlPath,
 * since -S names the ssh program in sftp. If the master is gone, the command fails at
 * once instead of opening a connection of its own: ProxyCommand=false ends it.
 * @param {string} controlPath - Path of the control socket.
 * @returns {string[]} Options for ssh or sftp, without the destination.
 */
function buildControlOptions(controlPath) {
  return ["-o", `ControlPath=${controlPath}`, "-o", "ControlMaster=no", "-o", "BatchMode=yes", "-o", "ProxyCommand=false"];
}
//
/**
 * Builds the pkill/pgrep pattern that matches the processes of a master connection:
 * gcloud and ssh both carry ControlPath=<path> among their arguments, and the path is
 * unique. The pattern is an extended regular expression, so its special characters,
 * such as the "+" often found in the temporary directory of macOS, are escaped.
 * @param {string} controlPath - Path of the control socket.
 * @returns {string} The pattern.
 */
function controlPathPattern(controlPath) {
  return `ControlPath=${controlPath}`.replace(REGEX_SPECIAL_PATTERN, "\\$&");
}
//
/**
 * Checks a private key the way gcloud compute ssh will use it, before gcloud runs.
 * gcloud reads the public key from <file>.pub and treats an empty or unreadable file
 * as a broken pair: catching that here gives a clear message instead of gcloud's
 * failure, which buildSshArgs() turns into an error rather than an overwrite. The
 * private key is never read, only checked for size and access. Never throws, since
 * both the wizard and the SSH command call it outside a try: any I/O error becomes
 * the message.
 * @param {string} keyFile - Private key path, already expanded.
 * @returns {Promise<string|null>} What is wrong with the key pair, or null.
 */
async function describeSshKeyProblem(keyFile) {
  if (!path.isAbsolute(keyFile)) {
    return `SSH key "${keyFile}" must be an absolute path, or start with ~/ (ssh.keyFile).`;
  }
  if (keyFile.endsWith(".pub")) {
    return `SSH key "${keyFile}" is a public key: set ssh.keyFile to the private key next to it.`;
  }
  try {
    const stat = await fs.stat(keyFile);
    if (stat.isDirectory()) {
      return `SSH key "${keyFile}" is a folder, not a private key file.`;
    }
    if (!stat.isFile()) {
      return `SSH key "${keyFile}" is not a regular file.`;
    }
    if (stat.size === 0) {
      return `SSH key "${keyFile}" is empty.`;
    }
    await fs.access(keyFile, fs.constants.R_OK);
  } catch (err) {
    return err.code === "ENOENT" ? `SSH key "${keyFile}" not found.` : `SSH key "${keyFile}" is not readable (${err.code || err.message}).`;
  }
  //
  const publicKeyFile = `${keyFile}.pub`;
  let firstLine;
  try {
    firstLine = (await fs.readFile(publicKeyFile, "utf8")).split(/\r?\n/)[0];
  } catch (err) {
    if (err.code === "ENOENT") {
      return `Public key "${publicKeyFile}" not found, and gcloud needs it next to the private key. Create it with: ssh-keygen -y -f ${quoteShellValue(keyFile)} > ${quoteShellValue(publicKeyFile)}`;
    }
    return `Public key "${publicKeyFile}" is not readable (${err.code || err.message}).`;
  }
  //
  // The conversion goes through a temporary file: redirecting onto the file being
  // read would truncate it before ssh-keygen reads it.
  if (!OPENSSH_PUBLIC_KEY_PATTERN.test(firstLine)) {
    const converted = `${publicKeyFile}.tmp`;
    return `Public key "${publicKeyFile}" is not in OpenSSH format. If it is an SSH2 key, convert it with: ssh-keygen -i -f ${quoteShellValue(publicKeyFile)} > ${quoteShellValue(converted)} && mv ${quoteShellValue(converted)} ${quoteShellValue(publicKeyFile)}`;
  }
  return null;
}
//
/**
 * Builds the environment that runs gcloud as the identity of a session: an SSH
 * session or an IAP tunnel.
 * The identity directory holds only the ADC file, not credentials of gcloud's own,
 * so the file reaches gcloud through the credential file override. The override
 * leaves core/account empty, while OS Login reads the user from it: it is set too.
 * auth/impersonate_service_account is never set, because an impersonated ADC file
 * already acts as the service account and gcloud would impersonate it twice.
 * @param {{identity: string, account: string, quotaProject: string|null}} session - SSH session or IAP tunnel.
 * @returns {object} The CLOUDSDK_* variables only, without the inherited environment.
 */
function buildSessionEnv(session) {
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
 * @param {object} session - SSH session, see buildSshArgs() and buildSessionEnv().
 * @returns {string} The equivalent shell command.
 */
function formatSshCommand(session) {
  return `${formatEnv(buildSessionEnv(session))} gcloud ${buildSshArgs(session).map(formatShellArg).join(" ")}`;
}
//
/**
 * Builds the gcloud arguments that open an IAP tunnel to a port of a VM instance.
 * Single source of truth for both the executed command and the printed hint.
 * The local port is 0, so gcloud picks a free one and prints it.
 * @param {{instance: string, projectId: string, zone: string, remotePort: number}} tunnel - IAP tunnel.
 * @returns {string[]} Arguments for gcloud.
 */
function buildIapTunnelArgs(tunnel) {
  return ["compute", "start-iap-tunnel", tunnel.instance, String(tunnel.remotePort), "--local-host-port=localhost:0", `--project=${tunnel.projectId}`, `--zone=${tunnel.zone}`];
}
//
/**
 * Renders the IAP tunnel command as the user would type it in a shell.
 * @param {object} tunnel - IAP tunnel, see buildIapTunnelArgs() and buildSessionEnv().
 * @returns {string} The equivalent shell command.
 */
function formatIapTunnelCommand(tunnel) {
  return `${formatEnv(buildSessionEnv(tunnel))} gcloud ${buildIapTunnelArgs(tunnel).map(formatShellArg).join(" ")}`;
}
//
/**
 * Renders the copy of one file as the user would type it in a shell, in the folder
 * the local file is in.
 * @param {object} session - SSH session, see buildScpArgs() and buildSessionEnv().
 * @param {object} transfer - Transfer, see buildScpArgs().
 * @returns {string} The equivalent shell command.
 */
function formatScpCommand(session, transfer) {
  return `${formatEnv(buildSessionEnv(session))} gcloud ${buildScpArgs(session, transfer).map(formatShellArg).join(" ")}`;
}
//
/**
 * Renders one remote command as the user would type it in a shell.
 * @param {object} session - SSH session, see buildRemoteCommandArgs() and buildSessionEnv().
 * @param {string} command - Remote command, as plain text.
 * @returns {string} The equivalent shell command.
 */
function formatRemoteCommand(session, command) {
  return `${formatEnv(buildSessionEnv(session))} gcloud ${buildRemoteCommandArgs(session, command).map(formatShellArg).join(" ")}`;
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
    const child = spawnGcloud(args, {
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
 * @param {object} session - SSH session, see buildSshArgs() and buildSessionEnv().
 * @returns {Promise<{code: number|null, signal: string|null}>} How gcloud exited.
 */
function runComputeSsh(session) {
  return new Promise((resolve, reject) => {
    const ignoreInterrupt = () => {};
    const cleanup = () => process.removeListener("SIGINT", ignoreInterrupt);
    process.on("SIGINT", ignoreInterrupt);
    const child = spawnGcloud(buildSshArgs(session), {
      stdio: "inherit",
      env: { ...inheritedEnvWithoutIdentity(), ...buildSessionEnv(session) }
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
/**
 * Runs gcloud as the identity of a session, for a command that ends on its own: a
 * remote command or a copy. Interactive, stdin is inherited and stderr is shown as it
 * arrives, so the prompts of gcloud, ssh or plink stay usable, while it is also kept for
 * the error; SIGINT reaches gcloud through the tty and this process ignores it meanwhile.
 * Otherwise stdin is closed, so an unexpected prompt fails instead of waiting, and
 * stderr is only kept.
 * @param {object} session - SSH session, see buildSessionEnv().
 * @param {string[]} args - Arguments for gcloud.
 * @param {{cwd?: string, interactive?: boolean}} [options] - Working directory, and whether prompts must reach the user.
 * @returns {Promise<{code: number|null, signal: string|null, interrupted: boolean, stdout: Buffer, stderr: string}>} How gcloud exited, whether SIGINT arrived meanwhile, and its output (stderr trimmed to its last lines).
 */
function runGcloudAs(session, args, options = {}) {
  return new Promise((resolve, reject) => {
    const interactive = Boolean(options.interactive);
    let interrupted = false;
    const onInterrupt = () => { interrupted = true; };
    const cleanup = () => process.removeListener("SIGINT", onInterrupt);
    if (interactive) {
      process.on("SIGINT", onInterrupt);
    }
    const child = spawnGcloud(args, {
      cwd: options.cwd,
      stdio: [interactive ? "inherit" : "ignore", "pipe", "pipe"],
      env: { ...inheritedEnvWithoutIdentity(), ...buildSessionEnv(session) }
    });
    const chunks = [];
    let stderrText = "";
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
      stderrText = (stderrText + chunk).slice(-TUNNEL_STDERR_CHARS);
      if (interactive) {
        process.stderr.write(chunk);
      }
    });
    child.on("error", err => {
      cleanup();
      reject(err.code === "ENOENT" ? new Error(GCLOUD_MISSING) : err);
    });
    child.on("close", (code, signal) => {
      cleanup();
      resolve({ code, signal, interrupted, stdout: Buffer.concat(chunks), stderr: tailLines(stderrText) });
    });
  });
}
//
/**
 * Returns the last lines of a captured stream, for an error message.
 * @param {string} text - Captured text.
 * @param {number} [lines] - Lines kept, TUNNEL_STDERR_LINES by default.
 * @returns {string} At most that many lines, trimmed.
 */
function tailLines(text, lines = TUNNEL_STDERR_LINES) {
  return String(text || "").trim().split(/\r?\n/).slice(-lines).join("\n");
}
//
/**
 * Builds the error of a tunnel that did not open, carrying what gcloud printed on stderr.
 * @param {string} message - Error message.
 * @param {string} stderr - Tail of gcloud's stderr, possibly empty.
 * @returns {Error} The error, with a stderr property.
 */
function tunnelError(message, stderr) {
  const err = new Error(message);
  err.stderr = stderr;
  return err;
}
//
/**
 * Opens an IAP tunnel to a port of a VM instance, as the identity of the tunnel.
 * gcloud prints "Listening on port [N]." on stdout without flushing it, so in a pipe
 * the line could wait for a full buffer: PYTHONUNBUFFERED makes it arrive at once.
 * The line is looked for on both streams, and both keep flowing for the whole life of
 * the process, so a full pipe never blocks gcloud. The child is not detached: it stays
 * in the terminal's process group, and closing the terminal ends it with this tool.
 * @param {object} tunnel - IAP tunnel, see buildIapTunnelArgs() and buildSessionEnv().
 * @param {{timeoutMs?: number}} [options] - Startup timeout, TUNNEL_START_TIMEOUT_MS by default.
 * @returns {Promise<{port: number, exited: Promise<{code: number|null, signal: string|null, stderr: string}>, stop: function(): Promise<void>}>} The local port, the exit of gcloud, and how to close the tunnel.
 * @throws {Error} If gcloud is missing, exits before printing the port, or times out; err.stderr carries its last lines.
 */
function startIapTunnel(tunnel, options = {}) {
  const timeoutMs = options.timeoutMs || TUNNEL_START_TIMEOUT_MS;
  const child = spawnGcloud(buildIapTunnelArgs(tunnel), {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...inheritedEnvWithoutIdentity(), ...buildSessionEnv(tunnel), PYTHONUNBUFFERED: "1" }
  });
  let stderrText = "";
  let spawnError = null;
  const scanned = { stdout: "", stderr: "" };
  //
  // Created at spawn, so a tunnel that already exited is still awaited correctly.
  // The error listener stays for the whole life of the child: an unhandled "error" would end the tool.
  const exited = new Promise(resolveExit => {
    child.on("error", err => { spawnError = spawnError || err; });
    child.once("close", (code, signal) => resolveExit({ code, signal, stderr: tailLines(stderrText) }));
  });
  //
  /**
   * Terminates gcloud, then kills it if it is still running after TUNNEL_KILL_GRACE_MS.
   * @returns {Promise<void>}
   */
  function stop() {
    return stopChild(child, exited);
  }
  //
  return new Promise((resolve, reject) => {
    let settled = false;
    const startTimer = setTimeout(() => {
      settled = true;
      stop().then(() => reject(tunnelError(`The IAP tunnel did not open within ${Math.round(timeoutMs / 1000)} seconds.`, tailLines(stderrText))));
    }, timeoutMs);
    //
    /**
     * Collects a chunk of output and resolves once the port line shows up on either stream.
     * @param {string} name - "stdout" or "stderr".
     * @param {string} chunk - Output chunk.
     */
    function onOutput(name, chunk) {
      if (name === "stderr") {
        stderrText = (stderrText + chunk).slice(-TUNNEL_STDERR_CHARS);
      }
      if (settled) {
        return;
      }
      scanned[name] = (scanned[name] + chunk).slice(-TUNNEL_SCAN_CHARS);
      const match = TUNNEL_PORT_PATTERN.exec(scanned[name]);
      if (match) {
        settled = true;
        clearTimeout(startTimer);
        resolve({ port: Number(match[1]), exited, stop });
      }
    }
    //
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => onOutput("stdout", chunk));
    child.stderr.on("data", chunk => onOutput("stderr", chunk));
    exited.then(({ code }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(startTimer);
      if (spawnError) {
        reject(spawnError.code === "ENOENT" ? new Error(GCLOUD_MISSING) : spawnError);
        return;
      }
      const stderr = tailLines(stderrText);
      reject(tunnelError(stderr || `gcloud exited with code ${code} before opening the tunnel.`, stderr));
    });
  });
}
//
/**
 * Runs ssh with the given arguments, its output discarded.
 * @param {string[]} args - Arguments for ssh.
 * @returns {Promise<number|null>} The exit code, or null if ssh could not start.
 */
function runSshQuiet(args) {
  return new Promise(resolve => {
    const child = childProcess.spawn("ssh", args, { stdio: "ignore" });
    const killTimer = setTimeout(() => child.kill("SIGKILL"), CONTROL_COMMAND_TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(killTimer);
      resolve(null);
    });
    child.on("close", code => {
      clearTimeout(killTimer);
      resolve(code);
    });
  });
}
//
/**
 * Runs pkill or pgrep on a pattern of controlPathPattern().
 * @param {string} command - "pkill" or "pgrep".
 * @param {string[]} flags - Flags before -f, such as the signal of pkill.
 * @param {string} pattern - Pattern of controlPathPattern().
 * @returns {Promise<boolean>} True if some process matched.
 */
function runProcessMatch(command, flags, pattern) {
  return new Promise(resolve => {
    const child = childProcess.spawn(command, [...flags, "-f", pattern], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", code => resolve(code === 0));
  });
}
//
/**
 * Waits until no process matches a pattern, or until a time limit.
 * @param {string} pattern - Pattern of controlPathPattern().
 * @param {number} ms - Time limit.
 * @returns {Promise<boolean>} True if no process matches any more.
 */
async function waitUntilGone(pattern, ms) {
  const deadline = Date.now() + ms;
  while (await runProcessMatch("pgrep", [], pattern)) {
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise(resolve => setTimeout(resolve, PROCESS_POLL_MS));
  }
  return true;
}
//
/**
 * Tells whether the master connection of a control socket accepts commands.
 * @param {string} controlPath - Path of the control socket.
 * @returns {Promise<boolean>} True if the master answers -O check.
 */
async function isMasterRunning(controlPath) {
  try {
    await fs.access(controlPath);
  } catch {
    return false;
  }
  return await runSshQuiet([...buildControlOptions(controlPath), "-O", "check", CONTROL_HOST]) === 0;
}
//
/**
 * Ends a master connection at once, synchronously, for an exit handler: it sends
 * SIGTERM to gcloud and ssh, found by the path of their control socket. Never throws.
 * @param {string} controlPath - Path of the control socket.
 */
function stopSshMasterSync(controlPath) {
  try {
    childProcess.spawnSync("pkill", ["-TERM", "-f", controlPathPattern(controlPath)], { stdio: "ignore" });
  } catch {
    // Nothing more can be done while the process exits.
  }
}
//
/**
 * Builds the error of a master connection that did not open, carrying what gcloud
 * printed and whether SIGINT arrived meanwhile.
 * @param {string} message - Error message.
 * @param {string} stderr - Tail of gcloud's output, possibly empty.
 * @param {boolean} interrupted - Whether SIGINT arrived while the connection opened.
 * @returns {Error} The error, with stderr and interrupted properties.
 */
function masterError(message, stderr, interrupted) {
  const err = tunnelError(message, stderr);
  err.interrupted = interrupted;
  return err;
}
//
/**
 * Opens a master connection to a VM instance, as the identity of the session: gcloud
 * compute ssh with no remote command, whose control socket the later commands go
 * through, so the IAP tunnel and the login of gcloud are paid once. gcloud stays a
 * child of this process, with stdin closed and its output drained, keeping the tail
 * for the error. Passphrases and 2FA prompts go through /dev/tty, so the caller hands
 * the terminal over first; SIGINT is ignored meanwhile, so Ctrl+C ends gcloud and ssh,
 * which share the terminal's process group, and not the tool.
 * The connection is ready once the socket answers -O check. A gcloud that exits first,
 * or the timeout, close everything with stop() before rejecting. stop() closes in
 * three steps: -O exit if the socket exists; waiting for gcloud; then pkill on the
 * socket path, which reaches ssh too, the child of gcloud, whose pid is never known.
 * @param {object} session - SSH session, see buildSshArgs() and buildSessionEnv().
 * @param {string} controlPath - Path of the control socket, in a folder of this user.
 * @param {{timeoutMs?: number}} [options] - Startup timeout, MASTER_START_TIMEOUT_MS by default.
 * @returns {Promise<{exited: Promise<{code: number|null, signal: string|null, stderr: string}>, stop: function(): Promise<void>}>} The exit of gcloud, and how to close the connection.
 * @throws {Error} If gcloud is missing, exits first, or times out; err.stderr carries its last lines, err.interrupted tells a Ctrl+C.
 */
function startSshMaster(session, controlPath, options = {}) {
  const timeoutMs = options.timeoutMs || MASTER_START_TIMEOUT_MS;
  const pattern = controlPathPattern(controlPath);
  let interrupted = false;
  const onInterrupt = () => { interrupted = true; };
  process.on("SIGINT", onInterrupt);
  const child = spawnGcloud(buildSshMasterArgs(session, controlPath), {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...inheritedEnvWithoutIdentity(), ...buildSessionEnv(session) }
  });
  let outputText = "";
  let spawnError = null;
  //
  // ssh, the child of gcloud, keeps the output pipes after gcloud exits, so "close"
  // may come late: the exit counts, and the output gets a short grace to arrive.
  const exited = new Promise(resolveExit => {
    const finish = (code, signal) => resolveExit({ code, signal, stderr: tailLines(outputText) });
    child.on("error", err => { spawnError = spawnError || err; });
    child.once("close", finish);
    child.once("exit", (code, signal) => setTimeout(() => finish(code, signal), MASTER_OUTPUT_GRACE_MS));
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { outputText = (outputText + chunk).slice(-TUNNEL_STDERR_CHARS); });
  child.stderr.on("data", chunk => { outputText = (outputText + chunk).slice(-TUNNEL_STDERR_CHARS); });
  //
  let stopping = null;
  /**
   * Closes the master connection and waits for its processes to end. Idempotent.
   * @returns {Promise<void>}
   */
  function stop() {
    if (!stopping) {
      stopping = (async () => {
        //
        // Without a socket the master never opened, or is already gone: nothing would
        // make gcloud exit on its own, so the processes are ended at once.
        let socketExists = true;
        try {
          await fs.access(controlPath);
        } catch {
          socketExists = false;
        }
        if (socketExists) {
          await runSshQuiet([...buildControlOptions(controlPath), "-O", "exit", CONTROL_HOST]);
          await settlesWithin(exited, MASTER_EXIT_GRACE_MS);
        }
        await runProcessMatch("pkill", ["-TERM"], pattern);
        if (!await waitUntilGone(pattern, TUNNEL_KILL_GRACE_MS)) {
          await runProcessMatch("pkill", ["-KILL"], pattern);
        }
        await settlesWithin(exited, TUNNEL_KILL_GRACE_MS);
      })();
    }
    return stopping;
  }
  //
  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer = null;
    let startTimer = null;
    const settle = () => {
      settled = true;
      clearTimeout(startTimer);
      clearTimeout(pollTimer);
      process.removeListener("SIGINT", onInterrupt);
    };
    const fail = err => {
      settle();
      stop().then(() => reject(err));
    };
    startTimer = setTimeout(() => {
      if (!settled) {
        fail(masterError(`The SSH connection did not open within ${Math.round(timeoutMs / 1000)} seconds.`, tailLines(outputText), interrupted));
      }
    }, timeoutMs);
    exited.then(({ code, signal, stderr }) => {
      if (settled) {
        return;
      }
      if (spawnError) {
        fail(spawnError.code === "ENOENT" ? new Error(GCLOUD_MISSING) : spawnError);
        return;
      }
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      fail(masterError(stderr || `gcloud exited with ${reason} before the SSH connection opened.`, stderr, interrupted));
    });
    /**
     * Looks for the control socket until the master answers, unless startup already ended.
     */
    const poll = async () => {
      if (settled) {
        return;
      }
      if (await isMasterRunning(controlPath)) {
        if (!settled) {
          settle();
          resolve({ exited, stop });
        }
        return;
      }
      if (!settled) {
        pollTimer = setTimeout(poll, MASTER_POLL_MS);
      }
    };
    poll();
  });
}
//
module.exports = {
  CONTROL_HOST,
  spawnGcloud,
  stopChild,
  buildLoginArgs,
  formatLoginCommand,
  buildSshArgs,
  buildSessionEnv,
  buildIapTunnelArgs,
  buildRemoteCommandArgs,
  buildScpArgs,
  buildSshMasterArgs,
  buildControlOptions,
  controlPathPattern,
  defaultSshKeyFile,
  describeSshKeyProblem,
  formatSshCommand,
  formatIapTunnelCommand,
  formatScpCommand,
  formatRemoteCommand,
  loginAdc,
  revokeAdc,
  resolveActiveAccount,
  runComputeSsh,
  runGcloudAs,
  startIapTunnel,
  startSshMaster,
  stopSshMasterSync,
  tailLines
};
