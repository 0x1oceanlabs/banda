import { expect, test } from "vitest"
import type { HarnessView, Limits } from "@banda/contract/harnesses"
import { DAY, HOUR } from "@banda/ui/lib/words"
import {
  cardWindows,
  groupsOf,
  lastWords,
  pickStart,
  threadsWords,
  usesOf,
  weekStart,
  whoWords,
} from "./accounts"
import { usedOf } from "../thread/starts-on"

const entry = (id: string, harness: string, name = id): HarnessView => ({
  id,
  name,
  short: name,
  enabled: true,
  command: [],
  env: [],
  harness,
  kind: "subscription",
  mark: name[0]!,
  colour: 0,
  sessions: harness,
})

test("this week starts on Monday at midnight, on this computer's clock", () => {
  // Wednesday 2026-11-11, 15:30.
  const wednesday = new Date(2026, 10, 11, 15, 30).getTime()
  expect(weekStart(wednesday)).toBe(new Date(2026, 10, 9).getTime())
  // A Sunday is the end of the week before.
  const sunday = new Date(2026, 10, 15, 9).getTime()
  expect(weekStart(sunday)).toBe(new Date(2026, 10, 9).getTime())
  const monday = new Date(2026, 10, 16).getTime()
  expect(weekStart(monday)).toBe(monday)
})

test("an account's use is summed over the Projects, its latest turn the latest of them", () => {
  const uses = usesOf([
    [
      { harness: "claude", threads: 2, last: 100, turns: 5 },
      { harness: "codex", threads: 0, turns: 0 },
    ],
    [{ harness: "claude", threads: 1, last: 300, turns: 1 }],
    [],
  ])
  expect(uses.get("claude")).toEqual({ threads: 3, last: 300, turns: 6 })
  expect(uses.get("codex")).toEqual({ threads: 0, turns: 0 })
  expect(uses.get("work")).toBeUndefined()
})

test("the accounts go by Harness, each where its first entry stands", () => {
  const groups = groupsOf([
    entry("claude", "claude", "Work"),
    entry("codex", "codex"),
    entry("personal", "claude", "Personal"),
    entry("gemini", "gemini", "Gemini CLI"),
  ])
  expect(
    groups.map(({ harness, name, accounts }) => [
      harness,
      name,
      accounts.map((one) => one.id),
    ])
  ).toEqual([
    // Claude Code's own entry renamed Work still heads Claude Code.
    ["claude", "Claude Code", ["claude", "personal"]],
    ["codex", "Codex", ["codex"]],
    ["gemini", "Gemini CLI", ["gemini"]],
  ])
})

const limits = (over: Partial<Limits> = {}): Limits => ({
  harness: "claude",
  name: "Work",
  windows: [
    { id: "five_hour", kind: "session", label: "Session", used: 40 },
    { id: "seven_day", kind: "weekly", label: "Weekly", used: 120 },
    { id: "opus", kind: "weekly", label: "Weekly · Opus", used: 10 },
  ],
  ...over,
})

test("a card shows the plan and email, from the limits or the sign-in", () => {
  const who = { signed_in: true, label: "Claude Max", email: "a@b.c" }
  expect(whoWords(limits({ plan: "Max 20x" }), who)).toBe("Max 20x · a@b.c")
  expect(whoWords(undefined, who)).toBe("Claude Max · a@b.c")
  expect(whoWords(limits({ email: "x@y.z" }), undefined)).toBe("x@y.z")
  // No one signed in says no plan of its own.
  expect(whoWords(undefined, { signed_in: false, label: "" })).toBeUndefined()
})

test("a card shows the account's own two windows, and a passed reset as empty", () => {
  expect(cardWindows(limits()).map((w) => w.label)).toEqual([
    "Session",
    "Weekly",
  ])
  expect(cardWindows(undefined)).toEqual([])
  const now = 1_000
  expect(usedOf({ ...limits().windows[1]!, resets_at: 2_000 }, now)).toBe(100)
  expect(usedOf({ ...limits().windows[0]!, resets_at: 500 }, now)).toBe(0)
})

test("its Threads and its last use, in words", () => {
  expect(threadsWords(0)).toBe("No Threads")
  expect(threadsWords(1)).toBe("1 Thread")
  expect(threadsWords(4)).toBe("4 Threads")
  const now = new Date(2026, 10, 11, 15).getTime()
  expect(lastWords(undefined, now)).toBe("Not used yet")
  expect(lastWords(now - 10_000, now)).toBe("Used now")
  expect(lastWords(now - 2 * HOUR, now)).toBe("Used 2h ago")
  expect(lastWords(now - 30 * DAY, now)).toMatch(/^Used Oct 12$/)
})

test("the default and the fallback go in agents.toml's [start], by the entry's ID", async () => {
  const said: string[] = []
  const file = {
    set: (key: string, value: string) => {
      said.push(`${key} = ${value}`)
      return Promise.resolve([])
    },
    reset: (key: string) => {
      said.push(`${key} out`)
      return Promise.resolve([])
    },
    reveal: () => {},
  }
  await pickStart(file, "start.account", "work")
  await pickStart(file, "start.fallback", undefined)
  expect(said).toEqual(['start.account = "work"', "start.fallback out"])
})
