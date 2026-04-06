---
name: code-conventions
description: Code conventions for 8bitsapps-gcp-utils. Always apply when writing or modifying JS code.
user-invocable: false
---

## Formatting

- Never put empty lines inside a method; use a `//` line to separate code sections.
- Never put a comment right under a statement. Use an empty comment line before the next statement.
- Comments must always end with a period.
- Prefer `"` for strings; use backticks only for interpolation (`${var}`) or multiline.
- Use 2-space indentation, not tabs.
- Semicolons at end of statements.

## Modules

- CommonJS: require/module.exports.
- Node.js 22 LTS.
- Prefer requiring the whole class instead of using Destructuring Assignment.

## Output

- No `console.log` in command files — all output goes through `utils/ui.js` functions.
- Output functions must end with `\n` (or position cursor on a new line), never start with `\n`.

## GCPUtilities boundary

- No chalk or inquirer imports in `GCPUtilities/` files.
- No console output in `GCPUtilities/` beyond configuration loading messages.
