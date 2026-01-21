# code-analyzer.md

Configuration for the code analysis agent. Run this agent after making changes to verify code quality and compliance.

> **Note:** This file must always be written in English.

## Purpose
Analyze modified code to ensure it meets project standards, follows conventions, and has no security issues.

## When to run
- After completing code modifications.
- Before committing changes.
- When reviewing pull requests.

## Analysis checklist

### 1. Code formatting compliance
- [ ] Indentation uses 2 spaces (no tabs).
- [ ] Strings use double quotes (`"`) instead of single quotes (`'`).
- [ ] No empty lines inside methods (use `//` for visual separation).
- [ ] All comments end with a period.

### 2. Code quality
- [ ] No duplicated code blocks.
- [ ] Proper error handling with try/catch.
- [ ] Async/await preferred over manual Promise chains.
- [ ] No unused variables or imports.
- [ ] Functions have clear, single responsibilities.

### 3. Security checks
- [ ] No hardcoded credentials (API keys, passwords, tokens).
- [ ] Credentials loaded from external configuration files.
- [ ] Input validation on user-provided data.
- [ ] No sensitive data in logs.

### 4. Project structure
- [ ] Files are in the correct directories per AGENTS.md.
- [ ] Exports/imports are consistent and correct.
- [ ] New utilities added to `GCPUtils/index.js` if applicable.

### 5. Documentation
- [ ] AGENTS.md updated if project structure changed.
- [ ] Complex logic has explanatory comments.

## Output format

Generate a report with the following structure:

```markdown
## Code Analysis Report

### Summary
- Files analyzed: X
- Issues found: X (Y errors, Z warnings)

### Issues

#### [ERROR] file.js:line
Description of the issue.
**Suggested fix:** How to fix it.

#### [WARNING] file.js:line
Description of the issue.
**Suggested fix:** How to fix it.

#### [INFO] file.js:line
Observation or suggestion.

### Passed checks
- List of checks that passed.
```

## Severity levels
- **ERROR**: Must be fixed before commit. Violations of security rules or critical conventions.
- **WARNING**: Should be fixed. Style violations or potential issues.
- **INFO**: Suggestions for improvement. Optional fixes.

## Example commands

To run analysis on modified files:
```bash
# List modified files
git diff --name-only

# Check for hardcoded credentials
rg -i "(password|secret|api_key|private_key)" --type js

# Check for single quotes
rg "'" --type js

# Check for empty lines in methods (manual review needed)
```
