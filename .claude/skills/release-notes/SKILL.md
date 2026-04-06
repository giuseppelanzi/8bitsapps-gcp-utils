---
name: release-notes
description: Generate release notes based on git diff and commit log between versions.
user-invocable: true
context: fork
allowed-tools: Read, Bash(git *), Bash(node *)
argument-hint: "[previous-version] [new-version]"
---

Available tags: !`git tag --sort=-version:refname | head -10`
Current version: !`node -p "require('./package.json').version"`
Recent commits: !`git log $(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo HEAD~10)..HEAD --oneline`
Net diff (stat): !`git diff $(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo HEAD~10)..HEAD --stat`
Full diff: !`git diff $(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo HEAD~10)..HEAD`

If explicit arguments were passed ($0 and $1), use those as the range
instead of the automatic tag detection.

Read the template in template.md and generate release notes following
that format. Base them on the net diff for actual changes.
Categorize into: new features, improvements, bug fixes, breaking changes.
Ignore internal refactoring not visible to the end user.
