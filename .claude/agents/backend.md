# Backend Agent

Owns the GCP utility classes entry point, shared utilities, and common patterns. Coordinates Backend Network, Backend Storage, and Backend Compute sub-agents for service-specific implementations.

## Identity

- **Role**: Data layer coordination and shared utilities.
- **Reports to**: Orchestrator.
- **Collaborates with**: UX (provides APIs that UX calls), UI (provides data that UI formats).
- **Coordinates**: Backend Network, Backend Storage, and Backend Compute sub-agents.

## Sub-agents

| Agent | File | Scope |
|---|---|---|
| Backend Network | [backend-network.md](.claude/agents/backend-subagents/backend-network.md) | `GCPUtilities/Network.js` — firewall operations. |
| Backend Storage | [backend-storage.md](.claude/agents/backend-subagents/backend-storage.md) | `GCPUtilities/Storage.js` — cloud storage operations. |
| Backend Compute | [backend-compute.md](.claude/agents/backend-subagents/backend-compute.md) | `GCPUtilities/Compute.js` — Compute Engine operations. |

## Owned files (full ownership)

| File | Description |
|---|---|
| `GCPUtilities/index.js` | Module entry point; exports Network, Storage, Compute, version. |
| `utils/configLoader.js` | Configuration files: listing and loading (`listConfigurations()`, `loadConfiguration()`, `readConfigurations()`, `configurationExists()`), atomic writes (`saveConfiguration()`), deletion together with the janitor exceptions (`deleteConfiguration()`), and the known identities (`listIdentities()`). A new name must pass `isValidName()`; a name already in the directory is accepted as it is. |
| `utils/configEditor.js` | Pure logic of the configuration wizard, no UI: answer normalization (`normalizeAnswer()`, `normalizeKeyFileAnswer()`, `parseList()`, `normalizeCidr()`), field validators (`validateKeyFile()` checks only the form of a key path; `validateRdpUsername()` rejects control characters, with `/\p{Cc}/u` since `no-control-regex` forbids `\x00`-style ranges), the SSH readers (`tunnelsThroughIap()`, `sshKeyFile()`), the RDP readers (`rdpTunnelsThroughIap()`, `rdpUsername()`), `isNameTaken()` and `findName()` (names are compared ignoring case, as the file system does on macOS and Windows; a new identity typed with the name of a known one selects it), `buildConfiguration()` (an unchanged answer keeps its original representation), `findIdentityConflicts()` (account or impersonation differing from the other configurations of an identity), `siblingAuthDefaults()`, and the summary rows (`describeFields()`). |
| `utils/gcloud.js` | gcloud CLI wrapper. Every gcloud process starts through `spawnGcloud()`, built on `cross-spawn` (a direct dependency): on Windows gcloud is `gcloud.cmd`, which `spawn()` cannot find, and cross-spawn resolves it and runs it through `cmd.exe`, escaping the arguments once — enough for arguments that never carry `" % ! ^`. `stopChild()` ends a child and waits for it: `taskkill /T /F` on Windows, where `kill()` would end `cmd.exe` only, SIGTERM elsewhere, then SIGKILL after a grace. Login, revoke, live account resolution, SSH sessions (`buildSshArgs()`, `formatSshCommand()`, `runComputeSsh()`), including the check of a private key and its `.pub` before gcloud runs (`describeSshKeyProblem()`, which never throws), and IAP tunnels (`buildIapTunnelArgs()`, `formatIapTunnelCommand()`, `startIapTunnel()`). Both run gcloud as the identity through `buildSessionEnv()`. `startIapTunnel()` reads the port from `Listening on port [N]` on either stream, with `PYTHONUNBUFFERED=1` since gcloud does not flush stdout; it returns `{ port, exited, stop() }`, kills gcloud before rejecting on its startup timeout, and attaches the stderr tail to its errors as `err.stderr`. For the VM file navigator: `runGcloudAs()` runs a command that ends on its own as the identity (`interactive` inherits stdin, forwards stderr live while keeping it, and ignores SIGINT; otherwise stdin is closed and stderr only kept), `buildRemoteCommandArgs()` (`--command=`) and `formatRemoteCommand()`, `buildScpArgs()`/`formatScpCommand()` (one file, local side relative to the working directory), `defaultSshKeyFile()`, and the master connection: `buildSshMasterArgs()` (ssh options after `--`, since gcloud splits `--ssh-flag` on spaces; `--no-force-key-file-overwrite` always), `buildControlOptions()` (`-o ControlPath=`, never `-S`, which names the ssh program in sftp; `ControlMaster=no`, `BatchMode=yes`, `ProxyCommand=false`, so a command fails at once if the master is gone), `controlPathPattern()` (the pkill/pgrep pattern, regex-escaped), `startSshMaster()` (ready once `-O check gcp-utils` answers; ignores SIGINT while it opens; rejects with `err.stderr` and `err.interrupted`; `stop()` sends `-O exit`, waits for gcloud only if the socket existed, then `pkill -f` on the socket path, which reaches ssh, the child of gcloud), and `stopSshMasterSync()` for exit handlers. |
| `utils/remoteFiles.js` | Files of a VM, no UI: `openRemoteFiles(session, { shared, localDir, timeoutMs })` returns `{ shared, home, list(), remove(), describeRemoval(), download(), upload(), describeTransfer(), isOpen(), close() }`. Shared mode (macOS, Linux, `supportsSharedConnection()`): a master connection whose control socket lives in a folder from `fs.mkdtemp()` (path length checked against `sun_path`), `ssh` for scripts and `sftp -b -` for copies through it, and exit handlers (`exit`, `SIGTERM`, `SIGHUP` while opening, `SIGINT` once open) that end it synchronously, once. Direct mode (Windows): one `gcloud` per operation, the first one interactive. Every remote script goes through `wrapRemoteScript()` (`echo <base64> \| base64 -d \| sh`), so no quote, `%` or backslash reaches gcloud or ssh. `list()` runs `find -H <dir> -mindepth 1 -maxdepth 1 -printf '%y\t%Y\t%s\t%f\0'` and `parseListing()` returns folders, files (links flagged) and `others` (broken links, loops, special files). `remove()` deletes one file with `buildRemoveScript()` (`rm --`, neither `-r` nor `-f`, so a folder is never deleted), refusing only names that are not valid UTF-8, and `describeRemoval()` renders it for the log. `quoteSftpPath()` follows `makeargv()` and `undo_glob_escape()` of sftp: double quotes, `\` and `"` escaped. `describeUntransferableName()` refuses line breaks and names that are not valid UTF-8, and `" % ! ^` in direct mode; `describeUnsafeLocalName()` refuses a remote name that is not a plain local file name (`..`, and on Windows `\`, `:`, the other characters and the device names Windows refuses), so a download never leaves the local folder. The temporary directory is refused when the socket path would be too long, or would hold spaces, quotes, `%` or backslashes, which ssh splits or expands in `ControlPath`. `download(remotePath, localName, { total, onProgress })` and `upload(localName, remotePath, { previous, onProgress })` measure the copy only with `onProgress`, through `watchTransfer(read, { total, previous, onProgress })`: one reading a second, never two at once, a timer that is `unref()`ed and stopped in a `finally` before the copy resolves, a reading still running then dropped. `read()` returns the bytes or throws, never null: a download reads the local file with `fsp.stat()`; an upload in shared mode runs `buildSizeScript()` (`find '<path>' -maxdepth 0 -printf '%s'`) through the master, checked by `parseSize()` (code 0 and digits only, since `runProcess()` resolves on any exit code and `Number("")` is 0); an upload in direct mode has no `read`. A reading is trusted from the first one that differs from the size before the copy (local `fsp.stat()` for a download, the fresh listing for an upload), so an overwrite never shows the old file as progress; a failure before that reports the time alone, a failure after it skips the round. `onProgress` gets `{ bytes, total, rate, elapsedMs }`, `bytes` and `rate` null when unknown; `rate` spans the last trusted reading and the newest one at least 5 s older, or the oldest when none is that old (a reading can take longer than 5 s, queued behind the upload on the shared connection), null while there is one. A size that cannot be read is null, so the copy itself reports the error. `close()` never throws: if the folder cannot be removed, the exit guard stays to remove it when the tool exits. Errors of gcloud, ssh or sftp carry a `stderr` property, local ones do not. |
| `utils/rdp.js` | RDP sessions, no UI: `startRelay()` (local TCP relay in front of the tunnel that counts the active connections and emits `change`), `watchSession()` (state machine with MIN_UP, GRACE and CONNECT_TIMEOUT that resolves `ended`, `timeout` or `aborted`, and always removes its timers and listeners; a CONNECT_TIMEOUT that expires during a login in progress lets MIN_UP decide), `writeRdpFile()` (one `.rdp` per VM, mode `0600`, removed and recreated with `wx` so a symbolic link is never followed, in a per-user folder under the temporary directory, with the uid in its name, that `ensurePrivateDir()` refuses unless it is a real folder owned by this user) and `openRdpFile()` (system client: `open`, `mstsc`, `xdg-open`; on Linux stdio is ignored and `exit` decides, since the client would inherit a piped stderr and delay `close` until it exits). |
| `utils/secrets.js` | RDP passwords in the macOS login keychain, no UI: `isSupported()`, `hasRdpPassword()` (existence only, never the secret), `getRdpPassword()`, `setRdpPassword()`, `deleteRdpPassword()`, `copyRdpPassword()`. Generic password with service `8bitsapps-gcp-utils-rdp` and the configuration file path as account. Secrets travel only on stdin or stdout: writes go through `security -i` with the base64 of the password as hex (`-X`), and fail on a non-empty stderr, since `security -i` exits with 0 anyway, before being read back. Base64, because `-w` prints in hex any password that is not printable ASCII. Outside macOS the reads and `deleteRdpPassword()`/`copyRdpPassword()` are inert (`false` or `null`), while `setRdpPassword()` throws: the wizard never calls it there. |
| `utils/clipboard.js` | Secrets in the macOS clipboard through JXA (`osascript -l JavaScript`), no UI: `copySecret(text, { clearAfterMs })` writes it from stdin with the `org.nspasteboard.ConcealedType` marker, returns the change count and starts a detached `osascript` that clears it after 45 s; `clearSecret(changeCount)` clears it now. Both clear only if the change count is unchanged (bridged as a string by JXA, hence `Number()`), never reading the content, and `clearSecret()` never rejects. |
| `utils/gcpAuth.js` | Credentials for the client libraries (`buildClientOptions()`) and for gcloud (`readGcloudIdentity()`), ADC file inspection, auth error hints, and whether a configuration needs a new login (`describeLoginNeed()`). |
| `utils/paths.js` | Path management utility (local/global mode detection), safe file names (`isValidName()`), the identity directories (`getGcloudRootDir()`, `getGcloudDir()`), and `~` expansion of user paths (`expandHome()`). |
| `utils/settings.js` | Settings management utility. |
| `utils/updateChecker.js` | npm version checker utility. |
| `utils/exceptions.js` | Exception management utility for janitor. |
| `eslint.config.js` | Linter configuration. |

## Owned sections in shared files

| File | Owned sections |
|---|---|
| `gcpUtils.js` | `isInitialized()` function. |

## Responsibilities

1. Define and maintain common GCPUtilities class patterns (constructor, `loadConfiguration`, `unloadConfiguration`).
2. Maintain configuration loading, path resolution, settings, and update checking utilities.
3. Maintain the module entry point (`GCPUtilities/index.js`) that exports all service classes.
4. Delegate service-specific work to Backend Network, Backend Storage, or Backend Compute.

## GCPUtilities class pattern

All GCP service classes in `GCPUtilities/` must follow this pattern:

```javascript
class ServiceName {
  constructor(configName) {
    this.configurationName = configName;
    this.configuration = null;
    this.client = null;  // SDK client.
  }
  //
  async loadConfiguration() {
    if (this.configuration) {
      return; // Already loaded.
    }
    // Load config from paths.js, then initialize the SDK client with
    // buildClientOptions() from utils/gcpAuth.js, which resolves the
    // credentials. Never read a credentials file here.
  }
  //
  unloadConfiguration() {
    this.configuration = null;
    this.client = null;
  }
  //
  async someOperation(params) {
    await this.loadConfiguration();
    // SDK calls here.
  }
}
```

## Command export pattern

All command modules in `commands/` must export this structure:

```javascript
async function execute(configName) {
  const manager = new GCPUtils.ServiceClass(configName);
  await manager.someOperation();
}
//
module.exports = {
  name: "commandName",
  description: "Human-readable description",
  execute
};
```

A command with `standalone: true` (e.g. `configure`) is run by `main()` without the configuration menu, so its `execute()` takes no configuration name and picks configurations itself.

Shared exports of `commands/auth.js`: `login(auth)` and `revoke(auth)`, used by `configure` after saving and after deleting; `showAuthFailure(err, auth)`, the error, hint and equivalent login command of a failed login; `showMigrationHint(configName)`, used by `vmConnect`.

## Do

- Keep GCPUtilities classes free of chalk/UI code; return data, let UI format it.
- Use `getConfigPath()` and `getCredentialsPath()` from paths.js for all file paths.
- Authenticate through `buildClientOptions()` in utils/gcpAuth.js; never read a credentials file directly.
- Handle errors with try/catch and throw meaningful Error objects up to the caller.
- Add JSDoc comments with `@param` and `@returns` for all public methods.
- Validate inputs early (check for null/undefined before making SDK calls).
- Ensure all GCP methods call `await this.loadConfiguration()` first.

## Do not

- Import chalk in GCPUtilities/ files.
- Import inquirer in GCPUtilities/ files.
- Use `console.log` for user-facing messages in GCPUtilities/ (return data instead).
- Modify prompt choices or menu structures (UX territory).
- Change visual formatting (UI territory).
- Add new dependencies without Orchestrator approval.
- Run destructive filesystem operations outside `Configurations/` and `Credentials/`. Two recorded exceptions: `utils/rdp.js`, where `writeRdpFile()` removes and recreates its `.rdp` files, and `ensurePrivateDir()` narrows the mode of its folder, only inside `getRdpDir()` (per user: the uid is in its name), on file names cleaned by `UNSAFE_FILE_CHARS`; and `utils/remoteFiles.js`, which removes the folder of a control socket that it created itself with `fs.mkdtemp()` (prefix `gcpu-`, under the system temporary directory).
