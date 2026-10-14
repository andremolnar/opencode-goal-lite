---
name: changelog-entries
description: Create outstanding changelog entries in CHANGELOG.md using semantic versioning and standard sections. Use when the user mentions changelog updates, release notes, or documenting changes.
metadata:
  version: "1.0"
---

# Changelog Entries

## Overview

Write clear, high-signal changelog entries that map code changes to user-visible impact.

## Steps

1. Collect the set of modified and untracked files (staged and unstaged).
2. Inspect diffs for all files that will be committed.
3. Locate `CHANGELOG.md` in the repository root.
4. Determine the target version and date; follow semantic versioning (MAJOR.MINOR.PATCH).
5. Add a new version block using the standard section order: Added, Changed, Fixed, Deprecated, Breaking changes.
6. Add Removed or Security sections when the changes warrant them.
7. Summarize each change as a user-facing outcome; prefer short, specific bullets.
8. Link relevant issues or pull requests when available.
9. Keep wording consistent and avoid internal implementation details unless necessary for clarity.

## Inputs

- Target version and date (or the instruction to infer them).
- List of changes, commits, PRs, or issue references.

## Outputs

- Updated `CHANGELOG.md` with a new version section.

## Edge cases

- If no version is provided, propose the lowest-risk version bump and ask for confirmation.
- If changes span multiple categories, split them across the relevant sections.
- If no changes fit a section, leave the header with no bullets.

## References

- `references/changelog-guidelines.md`

## Example prompts

- "Add a changelog entry for the 1.4.0 release based on these PRs."
- "Update CHANGELOG.md for the bug fix I just made."
