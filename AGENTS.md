# AGENTS.md

Guidelines for agents (Codex CLI, Claude Code, etc.) working on this repository.

## How agents should operate
- Use `apply_patch`; avoid `git commit`/branch unless explicitly requested.
- Propose file modifications on behalf of the user.
- Search: prefer `rg` for file/text search; read files in chunks ≤ 250 lines.
- Planning: use `update_plan` for multi-step tasks; keep only one phase `in_progress`.
- Scope: minimal and focused changes; respect existing style; do not rename files without reason.
- Security: no network/installers/destructive commands without approval; do not open GUIs.
- Communication: concise messages before commands; brief progress updates.
- Communication: always propose changes in diff format, with deletions in red and additions in green.
- Validation: if possible, use repo scripts/commands to verify build/test, without introducing external tools.

### Agent-specific notes
- Codex CLI: follow the rules on `apply_patch`, `rg`, `update_plan` and pre-preamble before commands.
- Claude Code: follow this document as the canonical source; same constraints on editing, search, and communication.

## Code formatting
- Never put empty lines inside a method; use a `//` line to separate code sections.
- Comments must always end with a period.
- Prefer `"` over `'` for strings.
- Use 2-space indentation, not tabs.

## Project description
This project provides a set of utilities for interacting with Google Cloud Platform (GCP) services.

## Runtime and language
- Node.js 22 LTS
- ECMAScript Modules (type: module)
- Standard JavaScript (no TypeScript)

## Project structure (binding)
- `GCPUtils/`: Contains reusable classes for interacting with GCP services.
  - `index.js`: Module entry point, exports Network and Storage.
  - `Network.js`: Handles network operations (firewall, etc.).
  - `Storage.js`: Handles upload operations to GCS.
- `Configurations/`: Contains JSON configuration files for various projects.
- `Credentials/`: Contains JSON files with GCP service account credentials.
- `myIpToFirewallRule.js`: Main example script that uses the utilities.

## Configuration
Files in `Configurations/` follow this format:
```json
{
  "credentialsFile": "credentials-file-name.json",
  "defaultProjectId": "GCP_PROJECT_ID",
  "defaultFirewallRule": "FIREWALL_RULE_NAME",
  "defaultFixedIPAddresses": ["x.x.x.x/32"],
  "defaultBucket": "GCS_BUCKET_NAME"
}
```

## Usage
```bash
node myIpToFirewallRule.js <configurationName>
```
Example: `node myIpToFirewallRule.js example` loads `Configurations/gcp-options-example.json`.
