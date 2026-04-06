---
name: review
description: Code review for quality, style, and architectural consistency after code changes.
user-invocable: true
context: fork
allowed-tools: Read, Grep, Glob, Bash(git diff*), Bash(git log*)
---

Changed files: !`git diff --name-only HEAD~1`
Net diff: !`git diff HEAD~1`

## Checks

1. **Code conventions** — compliance with rules in `.claude/skills/code-conventions/SKILL.md`.
2. **Agent boundary** — each file is modified only by the responsible agent (see `.claude/agents/` for ownership).
3. **Circular dependencies** — none introduced between modules.
4. **Edge cases** — unhandled scenarios.
5. **Duplications** — duplicated code across modules.

## Backend checklist (GCPUtilities/, utils/)

- `loadConfiguration()` called before SDK operations.
- Errors caught and re-thrown with meaningful messages.
- No chalk/inquirer in `GCPUtilities/`.
- New methods follow the existing pattern.

## UX checklist (prompts, menus, navigation)

- ESC returns null in all menus.
- Back navigation returns `{ action: "back" }`.
- All menus use numbered choices (`${i + 1}. label`).

## UI checklist (chalk, ANSI, formatting)

- Colors consistent with the palette in `ui.md`.
- ANSI escapes paired (write → clear after operation).
- Loading indicators (`⏳`) cleared after completion.

## Security checklist

- No credentials or secrets in committed code.
- No `eval()`, `Function()`, or dynamic require with user input.
- No destructive filesystem operations outside `Configurations/` and `Credentials/`.

## Output

Produce a structured report: **BLOCKERS** / **WARNINGS** / **SUGGESTIONS**.

```
APPROVED - [summary of what was reviewed]
```

or

```
CHANGES REQUESTED:
1. [file.js:line] Issue description.
   Suggestion: how to fix it.
   Agent: which agent should handle the fix.
```

$ARGUMENTS
