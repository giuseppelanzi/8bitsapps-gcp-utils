# AGENTS.md

Multi-agent guidelines for **8bitsapps-gcp-utils** — a Node.js CLI that manages GCP firewall rules, cloud storage, and Compute Engine resources.

## Architecture overview

```
                         ┌─────────────────┐
                         │  Orchestrator   │
                         │ (coordination)  │
                         └────────┬────────┘
                                  │
                  ┌───────────────┼────────────────┐
                  │               │                │
           ┌──────┴──────┐  ┌─────┴─────┐  ┌───────┴──────┐
           │   Backend   │  │    UX     │  │      UI      │
           │ (GCP + cfg) │  │  (flows)  │  │  (visual)    │
           └──────┬──────┘  └─────┬─────┘  └───────┬──────┘
                  │               │                │
                  └───────┬───────┴───────┬────────┘
                          │               │
                   ┌──────┴──────┐ ┌──────┴──────┐
                   │   Tester    │ │  Reviewer   │
                   │ (validate)  │ │  (quality)  │
                   └─────────────┘ └─────────────┘
```

## Agent table

| Agent | File | Scope |
|---|---|---|
| Orchestrator | [.claude/agents/orchestrator.md](.claude/agents/orchestrator.md) | Workflow coordination, task routing, main loop in gcpUtils.js. |
| Backend | [.claude/agents/backend.md](.claude/agents/backend.md) | GCPUtilities/, utils/, shared patterns. |
| UX | [.claude/agents/ux.md](.claude/agents/ux.md) | Interaction flows, navigation state, prompt design, menu structure. |
| UI | [.claude/agents/ui.md](.claude/agents/ui.md) | Visual output, utils/ui.js, commands/, banner, formatting. |
| Tester | [.claude/agents/tester.md](.claude/agents/tester.md) | Lint validation, manual verification checklists. |
| Reviewer | [.claude/agents/reviewer.md](.claude/agents/reviewer.md) | Code review, style enforcement, architecture consistency. |

## Workflow

```
Request ─▸ Orchestrator ─▸ [Backend, UX, UI] ─▸ Tester ─▸ Reviewer ─▸ Done
                ▴                                   │          │
                └───────────────────────────────────┴──────────┘
                              (issues found)
```

1. **Request** arrives at Orchestrator.
2. Orchestrator decomposes it and assigns sub-tasks to Backend, UX, and/or UI.
3. Backend builds data layer first (others may depend on its API).
4. UX designs the interaction flow, referencing Backend's exported functions.
5. UI implements visual presentation and command files for the flow UX designed.
6. Tester validates (lint + manual checklist). Issues go back to the originating agent.
7. Reviewer checks style, architecture, and boundary compliance. Issues go back to the originating agent.
8. Reviewer approves -> task complete.

## File ownership

When modifying shared files, the responsible agent makes the change and tags the other agents for review of their owned sections. Detailed boundaries for shared files are documented in each agent's own file.

| File | Primary owner | Shared with |
|---|---|---|
| `gcpUtils.js` | Orchestrator (main loop) | UX (menus), UI (banner), Backend (isInitialized) |
| `GCPUtilities/index.js` | Backend | — |
| `GCPUtilities/Network.js` | Backend | — |
| `GCPUtilities/Storage.js` | Backend | — |
| `GCPUtilities/Compute.js` | Backend | — |
| `commands/index.js` | Orchestrator | — |
| `commands/init.js` | UI | Backend (paths.js calls) |
| `commands/updateFirewall.js` | UI | Backend (Network class) |
| `commands/storageNavigator.js` | UX (flow/state) | Backend (storage calls), UI (formatting) |
| `commands/gcpJanitor.js` | UX (flow/state) | Backend (compute calls), UI (formatting) |
| `utils/ui.js` | UI | — |
| `utils/configLoader.js` | Backend | — |
| `utils/paths.js` | Backend | — |
| `utils/settings.js` | Backend | — |
| `utils/updateChecker.js` | Backend | — |
| `utils/exceptions.js` | Backend | — |
| `utils/prompts/listWithEscape.js` | UX | UI (ANSI escapes) |
| `eslint.config.js` | Backend | — |
| `package.json` | Orchestrator | — |
| `AGENTS.md` | Orchestrator | — |
| `CLAUDE.md` | Orchestrator | — |

## Agent file naming convention

- Top-level agents live in `.claude/agents/` and are named `[area].md` (e.g., `backend.md`, `ui.md`).
- Sub-agents live in `.claude/agents/[area]-subagents/` and are named `[area]-[subarea].md` (e.g., `backend-subagents/backend-storage.md`).
- Every agent file name must be globally unique across the entire `.claude/agents/` tree. No two files may share the same name, even in different folders.

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
- Never put a comment right under a statement. Use an empty comment line before the next statement.
- Comments must always end with a period.
- Prefer `"` for strings; use backticks only for interpolation (`${var}`) or multiline.
- Use 2-space indentation, not tabs.
- No `console.log` in command files — all output goes through `utils/ui.js` functions.
- Output functions must end with `\n` (or position cursor on a new line), never start with `\n`.
- Prefer requiring the whole class instead of using Destructuring Assignment.
- Semicolons at end of statements.

## Project description

This project provides a set of utilities for interacting with Google Cloud Platform (GCP) services.

## Runtime and language

- Node.js 22 LTS.
- CommonJS modules (require/module.exports).
- Standard JavaScript (no TypeScript).

## Project structure

```
gcpUtils.js                        # CLI entry point (Orchestrator + UX + UI).
GCPUtilities/                      # GCP service classes (Backend).
  index.js                         #   Module exports: Network, Storage, Compute, version.
  Network.js                       #   Firewall operations class.
  Storage.js                       #   GCS storage class.
  Compute.js                       #   Compute Engine class.
commands/                          # Command implementations (UI + UX + Backend).
  index.js                         #   Command registry (Orchestrator).
  init.js                          #   Initialize config directories (UI).
  updateFirewall.js                #   Firewall update command (UI).
  storageNavigator.js              #   Interactive storage browser (UX + UI + Backend).
  gcpJanitor.js                    #   GCP Janitor resource analyzer (UX + UI + Backend).
utils/                             # Shared utilities.
  ui.js                            #   UI helpers: ANSI, progress, formatting, messages (UI).
  configLoader.js                  #   List configurations (Backend).
  paths.js                         #   Path management (Backend).
  settings.js                      #   Settings management (Backend).
  updateChecker.js                 #   npm version checker (Backend).
  exceptions.js                    #   Exception management for janitor (Backend).
  prompts/                         #   Custom prompts.
    listWithEscape.js              #   Inquirer prompt with ESC/back/delete (UX + UI).
Configurations/                    # JSON config files (gitignored).
Credentials/                       # GCP credentials (gitignored).
```

## Configuration

Files in `Configurations/` follow this format:
```json
{
  "credentialsFile": "credentials-file-name.json",
  "defaultProjectId": "GCP_PROJECT_ID",
  "defaultFirewallRule": "FIREWALL_RULE_NAME",
  "defaultFixedIPAddresses": ["x.x.x.x/32"],
  "defaultBucket": "GCS_BUCKET_NAME",
  "buckets": [
    { "name": "bucket-name", "displayName": "Friendly Name" }
  ]
}
```

## Usage

```bash
gcpUtils                                    # Interactive CLI.
```

## Validation

```bash
npm test        # Runs eslint.
npm run lint    # Same as test.
```
