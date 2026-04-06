---
name: test
description: Run lint and code validation with npm test.
user-invocable: true
allowed-tools: Bash(npm test), Bash(npm run lint)
---

Lint result: !`npm test`

Analyze the output.
- If all OK: report "✓ Lint passed"
- If there are errors: list file, line, and message for each issue

Produce a concise report with the final outcome.
