import { describe, expect, it } from "vitest"
import type { UpdateState } from "@banda/contract/updates"
import type { Update } from "@banda/core"
import {
  allOn,
  lookedWords,
  type MachineUpdates,
  newestOf,
  outWords,
  rowOf,
  waitWords,
  worstOf,
} from "./machines"

const now = Date.UTC(2026, 10, 12, 9, 0)
const MINUTE = 60_000
const said = (more: Partial<UpdateState> = {}): UpdateState => ({
  running: "0.1.0-dev.640",
  newest: "0.1.0-dev.642",
  ...more,
})
const devbox = (more: Partial<MachineUpdates> = {}): MachineUpdates => ({
  host: "devbox",
  name: "devbox",
  icon: "server",
  away: false,
  ...more,
})
const waits = { turns: 0, terminals: 0, person: false }

describe("a machine's row says what its engine said", () => {
  it("one away says it updates itself once back, with no acts", () => {
    expect(rowOf(devbox({ away: true, said: said() }), now)).toEqual({
      kind: "away",
      from: "dev.640",
      say: "Updates itself once it is back.",
      restarts: false,
    })
  })

  it("one downloading shows how far", () => {
    const row = rowOf(
      devbox({
        said: said({
          taking: { version: "0.1.0-dev.642", share: 0.5, size: 68_000_000 },
        }),
      }),
      now
    )
    expect(row).toMatchObject({
      kind: "taking",
      from: "dev.640",
      to: "dev.642",
      share: 0.5,
      size: "34 of 68 MB",
      restarts: false,
    })
  })

  it("a copy ready waits for the Threads and terminals that hold it", () => {
    const row = rowOf(
      devbox({
        said: said({
          ready: "0.1.0-dev.642",
          waits: { ...waits, turns: 2, terminals: 1 },
        }),
      }),
      now
    )
    expect(row).toMatchObject({
      kind: "waits",
      from: "dev.640",
      to: "dev.642",
      say: "Restarts once 2 Threads finish and its terminal closes.",
      restarts: true,
    })
  })

  it("one set to ask says so, and whether Agents work there", () => {
    const row = rowOf(
      devbox({
        said: said({
          ready: "0.1.0-dev.642",
          takes: "ask",
          waits: { ...waits, person: true },
        }),
      }),
      now
    )
    expect(row).toMatchObject({
      kind: "ask",
      say: "Ready. devbox asks before it restarts. Nothing works there now.",
      restarts: true,
    })
  })

  it("one that moves only as Banda restarts there says why, with no Restart now", () => {
    const row = rowOf(
      devbox({
        said: said({
          ready: "0.1.0-dev.642",
          waits: { ...waits, restart: "Restarts with Banda's app" },
        }),
      }),
      now
    )
    expect(row).toMatchObject({
      kind: "waits",
      say: "Restarts with Banda's app.",
      restarts: false,
    })
  })

  it("one on the newest says when it moved, and whether between turns", () => {
    const updated = { from: "0.1.0-dev.640", at: now - 4 * MINUTE, idle: true }
    const row = rowOf(
      devbox({ said: said({ running: "0.1.0-dev.642", updated }) }),
      now
    )
    expect(row).toMatchObject({
      kind: "ok",
      from: "dev.642",
      say: "Updated 4m ago, between turns.",
    })
    expect(
      rowOf(
        devbox({
          said: said({ updated: { ...updated, idle: false, at: now } }),
        }),
        now
      ).say
    ).toBe("Updated just now.")
  })

  it("failed and off say the engine's words as a sentence", () => {
    expect(
      rowOf(devbox({ said: said({ failed: "No network" }) }), now)
    ).toMatchObject({ kind: "failed", say: "No network." })
    expect(
      rowOf(devbox({ said: said({ off: "The AUR updates Banda here." }) }), now)
    ).toMatchObject({ kind: "off", say: "The AUR updates Banda here." })
  })

  it("an engine older than its own updates says to update it once by hand", () => {
    expect(rowOf(devbox({ refused: true }), now).say).toBe(
      "Its Banda is older than its own updates: update it on devbox once."
    )
  })
})

describe("what a copy in place waits for", () => {
  it("counts the Threads, the terminals and the keys", () => {
    expect(waitWords({ ...waits, turns: 1 }, now)).toBe(
      "Restarts once its 1 Thread finishes."
    )
    expect(waitWords({ ...waits, terminals: 3 }, now)).toBe(
      "Restarts once its 3 terminals close."
    )
    const until = now + 7 * MINUTE
    const clock = new Date(until).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    })
    expect(
      waitWords({ ...waits, turns: 2, terminals: 1, typed_until: until }, now)
    ).toBe(
      `Restarts once 2 Threads finish, its terminal closes and no key reaches it until ${clock}.`
    )
  })

  it("a key typed long ago holds nothing", () => {
    expect(waitWords({ ...waits, typed_until: now - MINUTE }, now)).toBe(
      "Restarts in a moment."
    )
  })
})

describe("the bar's word over the window and every machine", () => {
  const app: Update = {
    name: "Banda Dev",
    have: "0.1.0-dev.640",
    always: true,
    state: "none",
  }
  const row = (machine: MachineUpdates) => ({
    machine,
    row: rowOf(machine, now),
  })
  const waiting = row(
    devbox({
      said: said({ ready: "0.1.0-dev.642", waits: { ...waits, turns: 2 } }),
    })
  )
  const failing = row(
    devbox({
      host: "m1pro",
      name: "m1pro",
      said: said({ failed: "No network" }),
    })
  )

  it("says the worst: failed, then a machine that waits, then a version ready", () => {
    const ready: Update = {
      ...app,
      state: "ready",
      version: "0.1.0-dev.642",
      notes: [],
    }
    expect(worstOf(ready, [waiting, failing])).toEqual({
      kind: "failed",
      pill: "m1pro",
    })
    expect(worstOf(ready, [waiting])).toEqual({
      kind: "waits",
      pill: "devbox waits",
    })
    expect(worstOf(ready, [])).toEqual({
      kind: "ready",
      pill: "dev.642",
      app: true,
    })
    expect(worstOf(app, [])).toEqual({ kind: "quiet", app: true })
  })

  it("the header says when the newest was out, or that all run it", () => {
    const here = devbox({
      host: undefined,
      said: said({ published: now - 20 * MINUTE }),
    })
    const newest = newestOf(app, here)
    expect(newest).toEqual({
      version: "0.1.0-dev.642",
      published: now - 20 * MINUTE,
    })
    expect(allOn(newest!.version, app, [here])).toBe(false)
    expect(outWords(newest, false, now)).toBe("out 20m ago")
    expect(outWords(newest, true, now)).toBe("the newest")
    expect(lookedWords(now - 3 * MINUTE, now)).toBe("Looked 3m ago")
  })
})
