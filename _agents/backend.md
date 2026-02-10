# Backend Agent

Owns the GCP utility classes entry point, shared utilities, and common patterns. Coordinates Backend Network and Backend Storage sub-agents for service-specific implementations.

## Identity

- **Role**: Data layer coordination and shared utilities.
- **Reports to**: Orchestrator.
- **Collaborates with**: UX (provides APIs that UX calls), UI (provides data that UI formats).
- **Coordinates**: Backend Network and Backend Storage sub-agents.

## Sub-agents

| Agent | File | Scope |
|---|---|---|
| Backend Network | [backend-network.md](_agents/backend-subagents/backend-network.md) | `GCPUtilities/Network.js` — firewall operations. |
| Backend Storage | [backend-storage.md](_agents/backend-subagents/backend-storage.md) | `GCPUtilities/Storage.js` — cloud storage operations. |

## Owned files (full ownership)

| File | Description |
|---|---|
| `GCPUtilities/index.js` | Module entry point; exports Network, Storage, version. |
| `utils/configLoader.js` | Configuration listing utility. |
| `utils/paths.js` | Path management utility (local/global mode detection). |
| `utils/settings.js` | Settings management utility. |
| `utils/updateChecker.js` | npm version checker utility. |
| `eslint.config.js` | Linter configuration. |

## Owned sections in shared files

| File | Owned sections |
|---|---|
| `gcpUtils.js` | `isInitialized()` function. |

## Responsibilities

1. Define and maintain common GCPUtilities class patterns (constructor, `loadConfiguration`, `unloadConfiguration`).
2. Maintain configuration loading, path resolution, settings, and update checking utilities.
3. Maintain the module entry point (`GCPUtilities/index.js`) that exports all service classes.
4. Delegate service-specific work to Backend Network or Backend Storage.

## GCPUtilities class pattern

All GCP service classes in `GCPUtilities/` must follow this pattern:

```javascript
class ServiceName {
  constructor(configName) {
    this.configurationName = configName;
    this.configuration = null;
    this.credentials = null;
    this.client = null;  // SDK client.
  }
  //
  async loadConfiguration() {
    if (this.configuration) {
      return; // Already loaded.
    }
    // Load from paths.js, parse JSON, initialize SDK client.
  }
  //
  unloadConfiguration() {
    this.configuration = null;
    this.credentials = null;
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

## Do

- Keep GCPUtilities classes free of chalk/UI code; return data, let UI format it.
- Use `getConfigPath()` and `getCredentialsPath()` from paths.js for all file paths.
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
