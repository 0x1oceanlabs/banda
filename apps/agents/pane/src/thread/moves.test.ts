import { describe, expect, test } from "vitest"
import type { HarnessView, Limits } from "@banda/contract/harnesses"
import { movesOf, stepped, waysOn } from "./moves"

const entry = (id: string, sessions: string, enabled = true): HarnessView => ({
  id,
  name: id,
  short: id,
  enabled,
  command: [],
  env: [],
  harness: sessions,
  kind: "subscription",
  mark: id[0].toUpperCase(),
  colour: 0,
  sessions,
})

const limits = (harness: string, ...used: number[]): Limits => ({
  harness,
  name: harness,
  windows: used.map((used) => ({
    used,
    resets_at: 2_000,
  })) as Limits["windows"],
})

const list = [
  entry("claude", "claude"),
  entry("work", "claude"),
  entry("off", "claude", false),
  entry("codex", "codex"),
]

describe("movesOf", () => {
  test("the Harness's accounts first, then the others, with their room", () => {
    const { same, others } = movesOf(
      list,
      "claude",
      ["claude"],
      [limits("work", 40, 100), limits("codex", 12)],
      1_000
    )
    expect(same.map((move) => move.harness.id)).toEqual(["claude", "work"])
    expect(same[0].on).toBe(true)
    expect(same[1]).toMatchObject({ fullest: 100, out: { until: 2_000 } })
    expect(
      others.map((move) => [move.harness.id, move.fullest, move.back])
    ).toEqual([["codex", 12, false]])
  })

  test("a Harness the Thread ran on before is a way back", () => {
    const { others } = movesOf(list, "work", ["codex", "work"], [], 0)
    expect(others[0]).toMatchObject({ back: true, same: false })
  })
})

describe("stepped", () => {
  test("the next account round the list, past one that is out", () => {
    const three = [entry("a", "c"), entry("b", "c"), entry("d", "c")]
    const { same } = movesOf(three, "a", [], [limits("b", 100)], 0)
    expect(stepped(same, 1)?.harness.id).toBe("d")
    expect(stepped(same, -1)?.harness.id).toBe("d")
    expect(
      stepped(movesOf([entry("a", "c")], "a", [], [], 0).same, 1)
    ).toBeUndefined()
  })
})

describe("waysOn", () => {
  const four = [...list, entry("home", "claude")]
  const out = [limits("claude", 100), limits("work", 60), limits("home", 20)]
  const ids = (ways: ReturnType<typeof waysOn>) =>
    ways.map((move) => move.harness.id)

  test("the account of its Harness with the most room first, then another Harness", () => {
    const { same, others } = movesOf(four, "claude", [], out, 1_000)
    expect(ids(waysOn(same, others))).toEqual(["home", "codex"])
  })

  test("the fallback first, when it has room", () => {
    const { same, others } = movesOf(four, "claude", [], out, 1_000)
    expect(ids(waysOn(same, others, "codex"))).toEqual(["codex", "home"])
    expect(ids(waysOn(same, others, "claude"))).toEqual(["home", "codex"])
  })

  test("another Harness when every account of its own is out", () => {
    const { same, others } = movesOf(
      list,
      "claude",
      [],
      [limits("claude", 100), limits("work", 100)],
      1_000
    )
    expect(ids(waysOn(same, others))).toEqual(["codex"])
  })

  test("a Harness whose limits say room before one whose limits are not read", () => {
    const { same, others } = movesOf(
      [entry("opencode", "opencode"), ...list],
      "claude",
      [],
      [limits("claude", 100), limits("work", 100), limits("codex", 23)],
      1_000
    )
    expect(ids(waysOn(same, others))).toEqual(["codex"])
  })
})
