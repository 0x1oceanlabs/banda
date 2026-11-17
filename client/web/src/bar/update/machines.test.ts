import { describe, expect, it } from "vitest"
import type { AppUpdate, UpdateState } from "@banda/contract/updates"
import {
  lookedWords,
  type MachineUpdates,
  newestOf,
  plainOf,
  rowOf,
  titleOf,
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
const app: AppUpdate = {
  name: "Banda Dev",
  running: "0.1.0-dev.640",
  always: true,
  phase: "none",
}
const ready: AppUpdate = {
  ...app,
  phase: "ready",
  version: "0.1.0-dev.642",
}

describe("a machine's row: one word, at most one button", () => {
  it("one away says Away, and nothing more", () => {
    expect(rowOf(devbox({ away: true, said: said() }), now)).toEqual({
      kind: "away",
      from: "dev.640",
      status: "Away",
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
      to: "dev.642",
      share: 0.5,
      status: "34 of 68 MB",
    })
    expect(row.act).toBeUndefined()
  })

  it("a copy waiting for Agents says so, with no button: it updates by itself", () => {
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
      to: "dev.642",
      status: "After 2 Agents",
      why: "Updates by itself once 2 Agents finish and its terminal closes.",
    })
    expect(row.act).toBeUndefined()
  })

  it("one set to ask has its Update", () => {
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
    expect(row).toMatchObject({ kind: "ready", act: "update", engine: true })
  })

  it("one on the newest is Up to date", () => {
    expect(
      rowOf(devbox({ said: said({ running: "0.1.0-dev.642" }) }), now)
    ).toEqual({ kind: "ok", from: "dev.642", status: "Up to date" })
  })

  it("a failure says it in words, with the program's text behind Details", () => {
    expect(
      rowOf(devbox({ said: said({ failed: "fetch failed: ENOTFOUND" }) }), now)
    ).toMatchObject({
      kind: "failed",
      status: "Couldn't update",
      why: "Couldn't reach the releases. Check the connection.",
      details: "fetch failed: ENOTFOUND",
      act: "retry",
    })
  })

  it("an engine older than its own updates says to update it once by hand", () => {
    expect(rowOf(devbox({ refused: true }), now)).toMatchObject({
      kind: "off",
      status: "Update by hand",
    })
  })
})

describe("this machine's row holds this window's app, as its engine says it", () => {
  const here = devbox({ host: undefined, name: "M1PRO", icon: "laptop" })
  /** This machine, whose engine says `more` and what its app does. */
  const with_ = (app: AppUpdate, more: Partial<UpdateState> = {}) => ({
    ...here,
    said: said({ ...more, app }),
  })
  const copy = { ready: "0.1.0-dev.642", waits }

  it("an app ready is one Update, and the engine goes with it where it is ready", () => {
    expect(rowOf(with_(ready), now)).toMatchObject({
      kind: "ready",
      act: "update",
      app: true,
      engine: false,
    })
    expect(rowOf(with_(ready, copy), now)).toMatchObject({
      act: "update",
      app: true,
      engine: true,
    })
  })

  it("another machine's app is its own window's to show", () => {
    const there = devbox({ said: said({ app: ready }) })
    expect(rowOf(there, now)).toMatchObject({ kind: "ok" })
  })

  it("an app that could not is no program's text on the bar: words, and Details", () => {
    const failed: AppUpdate = {
      ...app,
      phase: "failed",
      why: "The first frame must be hello with a token this engine knows.",
    }
    expect(rowOf(with_(failed), now)).toMatchObject({
      kind: "failed",
      why: "Banda lost touch with itself for a moment.",
      details: "The first frame must be hello with a token this engine knows.",
      act: "retry",
    })
  })

  it("Installing, then Restarting, with no button", () => {
    for (const [phase, word] of [
      ["installing", "Installing"],
      ["restarting", "Restarting"],
    ] as const) {
      expect(rowOf(with_({ ...ready, phase }, copy), now)).toEqual({
        kind: "updating",
        from: "dev.640",
        to: "dev.642",
        status: word,
        why: "Banda restarts by itself in a moment.",
      })
    }
  })

  it("the bar turns, and the title names the version", () => {
    const row = rowOf(with_({ ...ready, phase: "installing" }, copy), now)
    const rows = [{ machine: here, row }]
    expect(worstOf(ready, rows)).toEqual({
      kind: "updating",
      version: "dev.642",
    })
    expect(titleOf(rows, undefined).title).toBe("Updating to dev.642")
  })

  it("an engine that stops with the app is asked nothing: the app's restart takes it", () => {
    const restart = { ...waits, restart: "it restarts with Banda" }
    const there = with_(ready, { ...copy, waits: restart, with_app: true })
    expect(rowOf(there, now)).toMatchObject({
      kind: "ready",
      act: "update",
      app: true,
      engine: false,
    })
  })

  it("an Update the engine holds for the Agents says so, with no button", () => {
    const held = with_(ready, { with_app: true, held: true })
    expect(rowOf(held, now, 2)).toEqual({
      kind: "waits",
      from: "dev.640",
      to: "dev.642",
      status: "After 2 Agents",
      why: "Updates by itself once 2 Agents finish.",
    })
    // Another machine's, by what its engine says it waits for.
    const there = devbox({
      said: said({
        ...copy,
        takes: "ask",
        held: true,
        waits: { ...waits, turns: 1 },
      }),
    })
    expect(rowOf(there, now)).toMatchObject({
      kind: "waits",
      status: "After 1 Agent",
    })
  })
})

describe("what a copy in place waits for", () => {
  it("counts the Agents, the terminals and the keys", () => {
    expect(waitWords({ ...waits, turns: 1 }, now)).toBe(
      "Updates by itself once its Agent finishes."
    )
    const until = now + 7 * MINUTE
    const clock = new Date(until).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    })
    expect(
      waitWords({ ...waits, turns: 2, terminals: 1, typed_until: until }, now)
    ).toBe(
      `Updates by itself once 2 Agents finish, its terminal closes and no one types there until ${clock}.`
    )
  })

  it("nothing holding it needs no line", () => {
    expect(waitWords({ ...waits, typed_until: now - MINUTE }, now)).toBe(
      undefined
    )
  })
})

describe("the bar's icon and the title", () => {
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
  const ok = row(devbox({ said: said({ running: "0.1.0-dev.642" }) }))

  it("says the worst: failed, then ready, and no pill", () => {
    expect(worstOf(ready, [waiting, failing])).toEqual({
      kind: "failed",
      name: "m1pro",
    })
    expect(worstOf(app, [waiting])).toEqual({
      kind: "ready",
      version: "dev.642",
    })
    expect(worstOf(app, [ok])).toEqual({ kind: "quiet" })
  })

  it("the title says it in one line", () => {
    expect(titleOf([waiting, failing], undefined).title).toBe(
      "Couldn't update m1pro"
    )
    expect(titleOf([waiting, ok], undefined).title).toBe(
      "Banda dev.642 is ready"
    )
    expect(titleOf([ok], "0.1.0-dev.642")).toEqual({
      title: "Banda is up to date",
      say: "dev.642 on every machine.",
    })
  })

  it("the newest is what this machine's engine found", () => {
    expect(newestOf(app, devbox({ host: undefined, said: said() }))).toBe(
      "0.1.0-dev.642"
    )
    expect(lookedWords(now - 3 * MINUTE, now)).toBe("Checked 3m ago")
  })

  it("words a few failures the Person can act on", () => {
    expect(plainOf("no room on devbox (needs 180 MB)")).toBe(
      "Not enough disk space."
    )
    expect(plainOf("sha512 mismatch")).toBe("The download was broken.")
    expect(plainOf("odd")).toBe("Something went wrong.")
  })
})
