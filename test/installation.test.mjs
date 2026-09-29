import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../dist/plugin.js"

test("global plugin defers to a project's local Goal Lite without registering tools or hooks", async () => {
  const root = await mkdtemp(join(tmpdir(), "goal-lite-local-priority-"))
  try {
    const plugins = join(root, ".opencode", "plugins")
    await mkdir(plugins, { recursive: true })
    await writeFile(join(plugins, "goal-lite.js"), "export default {}\n")

    const cleanup = await plugin.setup({
      location: { project: { canonical: root } },
      storage: { get: async () => { throw new Error("Global storage was read") } },
      tool: { transform: async () => { throw new Error("Global tools were registered") } },
      session: { hook: async () => { throw new Error("Global context hook was registered") } },
    })
    assert.equal(cleanup, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
