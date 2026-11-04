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
| `utils/configEditor.js` | Pure logic of the configuration wizard, no UI: answer normalization (`normalizeAnswer()`, `normalizeKeyFileAnswer()`, `parseList()`, `normalizeCidr()`), field validators (`validateKeyFile()` checks only the form of a key path), the SSH readers (`tunnelsThroughIap()`, `sshKeyFile()`), `isNameTaken()` and `findName()` (names are compared ignoring case, as the file system does on macOS and Windows; a new identity typed with the name of a known one selects it), `buildConfiguration()` (an unchanged answer keeps its original representation), `findIdentityConflicts()` (account or impersonation differing from the other configurations of an identity), `siblingAuthDefaults()`, and the summary rows (`describeFields()`). |
| `utils/gcloud.js` | gcloud CLI wrapper: login, revoke, live account resolution, and SSH sessions (`buildSshArgs()`, `buildSshEnv()`, `formatSshCommand()`, `runComputeSsh()`), including the check of a private key and its `.pub` before gcloud runs (`describeSshKeyProblem()`, which never throws). |
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

Shared exports of `commands/auth.js`: `login(auth)` and `revoke(auth)`, used by `configure` after saving and after deleting; `showAuthFailure(err, auth)`, the error, hint and equivalent login command of a failed login; `showMigrationHint(configName)`, used by `vmSsh`.

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
