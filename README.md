# Goal Lite for OpenCode V2

A small, project-neutral OpenCode V2 plugin that persists one goal per session: its objective, outcome criteria, binding constraints, an adaptable task list, and agent-recorded evidence. It adds a bounded post-compaction reminder and a deterministic readiness check. The included `goal-crafting` skill and `/goal` command guide contract creation, start or continuation, and discovery of applicable ADR and review guidance in the active project.

This repository was extracted from the Goal Lite implementation shipped to [CreativeXHub PR #200](https://github.com/snklinc/creativexhub/pull/200) at commit `69ca65c13de86f4d9f16fb656f6ed6b90b0bab50`. CreativeXHub retains its checked-in copy and its existing plugin storage ID; this standalone copy has the neutral `goal-lite` ID and can evolve independently.

## Install globally from this checkout

Requires OpenCode V2, Node.js and npm. From the repository root:

```sh
npm ci --ignore-scripts
npm run build
ln -s "$PWD/dist/plugin.js" "$HOME/.config/opencode/plugins/goal-lite.js"
ln -s "$PWD/.opencode/skills/goal-crafting" "$HOME/.config/opencode/skills/goal-crafting"
ln -s "$PWD/.opencode/commands/goal.md" "$HOME/.config/opencode/commands/goal.md"
```

Create the three target directories if missing. Check for existing targets before linking; do not overwrite a local installation. Restart OpenCode if the running service does not pick up the new files. Verify discovery with `opencode plugin list` and `/goal <desired outcome>` in a fresh session. Rebuild in this checkout when updating; the links point to its files and no package is installed or built on plugin startup.

Global plugin discovery loads the linked JavaScript file; global skill and command discovery load their links. Projects with their own `.opencode/plugins/goal-lite.js` or `.ts` take precedence: the global plugin does not register tools or a context hook there. Project skills and commands with the same ID likewise take precedence under OpenCode V2 discovery rules. This prevents the global installation from masking CreativeXHub goals stored under its legacy `creativexhub.goal-lite` plugin ID. Do not replace or delete that local loader to migrate existing goals.

To remove this global installation, remove only the three links named above. Do not delete this repository or its built output while the links are in use. Goal state is managed by OpenCode V2 plugin storage; removing the links does not erase it.

## Use

Run `/goal <desired outcome>` in the session where you want to work. The agent checks `tools.goal.status`, shows a concise contract, records it, and **begins its first actionable task in the same turn** using normal agent tools. With an existing active goal, `/goal` continues its next actionable task instead of drafting a new one; you can also ask the agent in the same session to check `tools.goal.status` and continue. A draft-only request does not start or execute a goal. If it only drafts when you intended execution, ask it to check `tools.goal.status`, start the contract if none was saved, and work on the first task. `tools.goal.start`, `tools.goal.status`, `tools.goal.update` and `tools.goal.finish` operate on session-scoped state with revision-checked updates. `policy.set` stores up to 10 relative ADR paths and 10 review-policy paths; these are pointers, not copied rules or proof of compliance.

The plugin's readiness report checks recorded criterion coverage, constraint review notes and required task status. It does not run tests, commands, models or reviewers, schedule a background agent, or verify the agent's evidence. Completion is an agent attestation of work done within the agreed scope. Human approval, merge and deployment are separate; "ready for human review" means an actual open PR and no **known** P0/P1 (or equivalent blocking) findings after applicable checks and review. If PR creation is not authorized, report the handoff pending rather than claiming a PR is open.

The context hook adds only bounded metadata to ordinary agent-loop requests. After compaction, use `tools.goal.status` to restore the full contract and saved policy pointers; revisit applicable sources when scope or guidance changes, not on every turn. Completed goals do not add reminders. Do not store secrets in goals or evidence.

## Develop and limits

```sh
npm run check
npm test
```

Tests cover transitions, stale revisions, concurrent updates within one process, corruption, simulated compaction/restart, and contrasting project policy fixtures. An earlier disposable V2 host test exercised manual compaction and restart; automatic overflow compaction was not exercised. OpenCode V2 plugin storage has no documented cross-process compare-and-swap: concurrent writes to the same session from two server processes are unsupported. A session has one goal; completed goals cannot be reopened in place.

This is not a fork or restoration of the removed Goal package and has no V1 entrypoint, autonomous verifier, shell executor, push, merge, or deployment authority.
