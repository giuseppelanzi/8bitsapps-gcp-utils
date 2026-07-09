---
name: release-notes
description: Generate release notes based on git diff and commit log between versions, show them for review, then publish them as a draft GitHub release on confirmation.
user-invocable: true
context: fork
allowed-tools: Read, Write, Bash(git *), Bash(gh *)
argument-hint: "[previous-version] [new-version]"
---

Available tags: !`git tag --sort=-version:refname | head -10`
Base tag: !`git describe --tags --abbrev=0 HEAD^`

## Range

Nothing above is pre-computed with the range, because these `!` commands cannot
use command substitution — the permission checker rejects it. Derive the range
first, then run the git commands yourself.

Arguments: $ARGUMENTS

Read that line as two whitespace-separated versions, the previous one then the
new one. Parse it yourself: positional placeholders never reach this skill, and
relying on them makes it fall back to auto-detection silently rather than fail.

When both versions are present, the range is `<previous>..<new>` and the
version being released is `<new>`. Confirm both resolve before trusting them,
so a typo fails loudly rather than yielding notes for the wrong range:

```
git rev-parse <previous> <new>
```

When that line is empty, auto-detect: the range is `<base tag>..HEAD` using the
base tag above, and the version being released is the tag pointing at HEAD. If
the base tag command errored because the repo has no tags, use `HEAD~10..HEAD`.

Then gather the material for the range:

```
git log <range> --oneline
git diff <range> --stat
```

Never take the version from `package.json` in the working tree: that file is
often already bumped to the *next* version, and an unrelated agent may be
mid-write on it.

## Step 1 — Write the notes

Work from the commit log and the `--stat` list of changed files. Never dump the
full diff of the range: it is too large and grows with every release. When a
commit message is not enough to tell what changed for the end user, inspect
that one file with `git diff <range> -- <path>` before describing it.

A range between two tags reads committed objects only, so uncommitted work in
the tree cannot leak into the notes.

Read the template in template.md and follow that format. Categorize into: new
features, improvements, bug fixes, breaking changes. Ignore internal
refactoring not visible to the end user. Drop any section with no entries,
Migration included.

Always write the notes in English, whatever language the conversation is in.
They are published on GitHub, where the audience is not the maintainer. This
applies to the notes themselves — keep talking to the user in their language.

Start the body at the first `##` heading, with no title line above it. GitHub
renders the release title over the body already, so an `# ...` heading there
would show up twice.

Save the result to `ReleaseNotes/RELEASE_NOTES_<version>.md`, where `<version>`
is the version being released — `ReleaseNotes/RELEASE_NOTES_2.0.0.md`. The
directory is gitignored, so the notes never reach a commit; they live on GitHub
instead. Writing the file creates the directory when it is missing, which it
will be on a fresh clone. The filename carries the version so that writing the
notes of an old release cannot clobber the notes of one still in preparation.

Being gitignored, these files are fair game for `git clean -xfd`. Do not treat
them as durable: publish, or copy the text out.

If that file already exists, do not overwrite it blindly. Read it, show the
user what is already there, and ask whether to replace it or to keep it and
write the new notes to a different name. Their previous draft may hold edits
worth keeping.

## Step 2 — Show them and stop

Print the full notes in the reply.

Then run `gh release list` — a read, and the only `gh` command allowed in this
step — to find out what publishing would actually do, and say which of the
three cases applies before asking:

- No release for the tag: a new draft will be created.
- A draft release exists: its notes will be replaced, still a draft.
- A **published** release exists: its notes will be rewritten in public, and
  the release stays published. Show what its current body holds, so the user
  knows what they are about to lose. Never present this case as "publishing a
  draft" — it is not one.

Now ask whether to go ahead, and stop. Publishing is the user's call, so a
missing answer means no: if they have not answered, or ask for changes, revise
the notes and show them again. Only an explicit go-ahead reaches step 3.

## Step 3 — Publish

Only after that go-ahead, and only for the case you named in step 2.

If a release for the tag exists, update it rather than creating a duplicate:

```
gh release edit <tag> --notes-file ReleaseNotes/RELEASE_NOTES_<version>.md
```

If the release turns out to be published and step 2 did not name that case —
someone published it in between, say — stop and ask again. The go-ahead you
hold covers a draft, not a live rewrite.

If no release exists for the tag, create it as a draft:

```
gh release create <tag> --title "v<tag>" --notes-file ReleaseNotes/RELEASE_NOTES_<version>.md --draft
```

Tag names in this repo carry no prefix (`2.0.0`); release titles do (`v2.0.0`).
If the tag does not exist on the remote yet, add `--target <commit>` so gh
creates it at the right commit.

Never change a release's published state. A draft stays a draft: do not pass
`--latest`, and do not run `gh release edit --draft=false`. A release that was
already published stays published — editing its notes must not also promote or
demote it. Turning a draft live is the user's job, on GitHub.

Finally, print the release URL.
