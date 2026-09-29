import type { Context } from "@opencode/plugin/promise/plugin"
import { decodeState } from "./codec.js"
import type { GoalState } from "./core.js"

type Storage = Pick<Context["storage"], "get" | "set">
const maxBytes = 256_000

/** Serializes writes in this plugin instance; V2 storage has no cross-process compare-and-swap. */
export class GoalStore {
  private readonly pending = new Map<string, Promise<unknown>>()

  constructor(private readonly storage: Storage) {}

  private key(sessionID: string): string {
    if (!sessionID || sessionID.length > 256) throw new Error("Invalid session ID")
    return `sessions/${encodeURIComponent(sessionID)}/goal`
  }

  async get(sessionID: string): Promise<GoalState | undefined> {
    const value = await this.storage.get(this.key(sessionID))
    return value === undefined ? undefined : decodeState(value, sessionID)
  }

  async update(sessionID: string, fn: (current: GoalState | undefined) => GoalState): Promise<GoalState> {
    const previous = this.pending.get(sessionID) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => {
      const current = await this.get(sessionID)
      const next = fn(current)
      if (next.sessionID !== sessionID) throw new Error("Cannot move a goal between sessions")
      const serialized = JSON.stringify(next)
      if (Buffer.byteLength(serialized, "utf8") > maxBytes) throw new Error("Goal exceeds storage size limit")
      decodeState(JSON.parse(serialized) as unknown, sessionID)
      await this.storage.set(this.key(sessionID), JSON.parse(serialized))
      return next
    })
    this.pending.set(sessionID, operation)
    try { return await operation }
    finally { if (this.pending.get(sessionID) === operation) this.pending.delete(sessionID) }
  }
}
