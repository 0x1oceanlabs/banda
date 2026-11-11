import { describe, expect, test } from "vitest"
import type { HarnessView, Limits } from "@banda/contract/harnesses"
import type { Move, Moves } from "../thread/moves"
import { startGroupsOf, whoOf } from "./who"

const entry = (id: string, harness: string): HarnessView => ({
  id,
  name: id,
  short: id,
  enabled: true,
  command: [],
  env: [],
  harness,
  kind: "subscription",
  mark: id[0].toUpperCase(),
  colour: 0,
  sessions: harness,
})

const move = (id: string, harness: string, more: Partial<Move> = {}): Move => ({
  harness: entry(id, harness),
  same: harness === "claude",
  on: false,
  back: false,
  ...more,
})

const plan = (harness: string, plan: string, also?: string[]): Limits => ({
  harness,
  name: harness,
  plan,
  also,
  windows: [],
})

const moves = (same: Move[], others: Move[]): Moves => ({
  same,
  others,
  confirm: true,
  title: "Claude Code",
})

describe("whoOf", () => {
  test("the account now, its plan and role, and the others by Harness", () => {
    const who = whoOf(
      moves(
        [
          move("personal", "claude", { on: true, fullest: 34 }),
          move("work", "claude", { fullest: 86 }),
        ],
        [move("codex", "codex", { fullest: 12 })]
      ),
      { default: "personal", fallback: "work" },
      [plan("personal", "Max 20x"), plan("work", "Max 5x")],
      80
    )
    expect(who?.now.move.harness.id).toBe("personal")
    expect(who?.now).toMatchObject({
      about: "Max 20x · default",
      used: 34,
      warns: false,
      idle: true,
    })
    expect(who?.same[1]).toMatchObject({
      about: "Max 5x · fallback",
      warns: true,
      idle: false,
    })
    expect(who?.others.map((row) => row.about)).toEqual([""])
    expect(who?.title).toBe("Claude Code")
  })

  test("an account that shares its limits reads its plan from the first", () => {
    const who = whoOf(
      moves([move("work", "claude", { on: true })], []),
      undefined,
      [plan("personal", "Max 20x", ["work"])],
      80
    )
    expect(who?.now.about).toBe("Max 20x")
  })

  test("an out account says when it is back, and its Harness's cannot be picked", () => {
    const who = whoOf(
      moves(
        [
          move("personal", "claude", { on: true }),
          move("team", "claude", { fullest: 100, out: { until: 5_000 } }),
        ],
        [move("codex", "codex", { out: {} })]
      ),
      undefined,
      [],
      80
    )
    expect(who?.same[1]).toMatchObject({
      used: undefined,
      warns: false,
      out: { until: 5_000 },
      idle: true,
    })
    // Another Harness's is handed to with its limit's card ahead.
    expect(who?.others[0]).toMatchObject({ out: {}, idle: false })
  })

  test("none when the Thread runs on no account in the list", () => {
    expect(
      whoOf(moves([move("work", "claude")], []), undefined, [], 80)
    ).toBeUndefined()
  })
})

describe("startGroupsOf", () => {
  test("every account under its Harness, an out one still to choose", () => {
    const groups = startGroupsOf(
      {
        same: [
          move("personal", "claude", { on: true }),
          move("team", "claude", { out: { until: 5_000 } }),
        ],
        others: [move("codex", "codex")],
      },
      (harness) => (harness === "claude" ? "Claude Code" : "Codex"),
      { default: "personal" },
      [],
      80
    )
    expect(
      groups.map((group) => [
        group.title,
        group.rows.map((row) => [row.move.harness.id, row.idle]),
      ])
    ).toEqual([
      [
        "Claude Code",
        [
          ["personal", true],
          ["team", false],
        ],
      ],
      ["Codex", [["codex", false]]],
    ])
  })
})
