# 8bitsapps-gcp-utils

Node.js CLI for managing GCP resources (firewall, storage, Compute Engine).

## Stack

- Node.js 22 LTS, CommonJS (require/module.exports).
- Standard JavaScript, no TypeScript.
- 2 spaces, double quotes, semicolons, no empty lines inside methods.

## Validation

```bash
npm test        # Runs eslint.
npm run lint    # Same as test.
```

## Agents

This project uses a multi-agent system. Read `.claude/agents/orchestrator.md`
before starting any non-trivial task.

## Available skills

| Skill | Invocable | Description |
|---|---|---|
| `code-conventions` | No (auto) | Code conventions, loaded automatically when writing JS. |
| `/test` | Yes | Runs lint and produces a summary report. |
| `/review` | Yes | Code review for quality, style, and architecture. |
| `/release-notes` | Yes | Generates release notes from git diff between tags, then publishes them as a draft GitHub release once you confirm. |
