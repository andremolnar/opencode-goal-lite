---
name: kick-ass-commit
description: Create world class, high quality commit messages that clarify what changed and why. Use when preparing to commit or when the user requests outstanding commit messages.
metadata:
  author: andrebot
  version: "1.1"
---

# Kick-Ass Commit

## Overview

Create world class, high quality commit messages that make it easy for people and coding agents to understand what happened.

## Steps

1. Collect the set of modified and untracked files (staged and unstaged).
2. Inspect diffs for all files that will be committed.
3. Check for documentation updates, including `README`, `CHANGELOG`, or similar files.
4. Determine an appropriate scope and a concise summary of the changes.
5. Draft a commit message using the template and include clear, factual bullet points.
6. When executing `git commit`, keep shell quoting safe: do not wrap file paths or snippets in backticks inside `-m` values because backticks trigger command substitution.
7. Immediately validate the final commit message with `git log -1 --format=%B` before any push.
8. If the message is malformed and the commit is not pushed yet, fix it with a new `git commit --amend -m "..." -m "..."`, then re-validate.
9. If the malformed commit was already pushed, do not rewrite history unless the user explicitly requests it; otherwise create a follow-up commit that corrects the record.

## Inputs

- Repository state (status, diff, staged files).
- Optional scope hint from the user.

## Outputs

- A commit message in the requested template.
- A short note if documentation changes are detected or missing.
- A validated final message check before push (`git log -1 --format=%B`).

## Edge cases

- If no changes are present, do not draft a commit; report that there is nothing to commit.
- If documentation changes are expected but missing, call it out and suggest adding them.
- If the scope is unclear, infer it from the dominant change area.
- If message text needs inline code formatting, keep markdown backticks in design notes only; do not include them in shell-executed `git commit -m` arguments.

## Commit template

```
[scope]: Brief description of changes

- Detailed bullet point about what changed
- Second detail point
- Nth detail point (as many as needed)
- N + 1th detail point
- etc.
```

## Example prompts

- "Craft a world class commit message for these changes"
- "Create a kick-ass commit message for this repo"
