import type {
  HarnessView,
  UsageRow,
  UsageTotal,
} from "@banda/contract/harnesses"
import { DAY } from "@banda/ui/lib/words"
import { expect, test } from "vitest"
import { paceOf } from "./limits"
import {
  COST,
  TOKENS,
  accountsOf,
  byAccount,
  byModel,
  colourOf,
  daysOf,
  changeWords,
  deltaOf,
  dollars,
  count,
  hitRate,
  rowsOn,
  spanOf,
  totalOf,
} from "./usage"

const view = (id: string, name: string, command: string[]): HarnessView => ({
  id,
  name,
  short: name,
  enabled: true,
  command,
  env: [],
})

const list = [
  view("claude", "Claude Code", [
    "npx",
    "@agentclientprotocol/claude-agent-acp",
  ]),
  view("work", "Work", ["npx", "@agentclientprotocol/claude-agent-acp"]),
  view("codex", "Codex", ["npx", "@agentclientprotocol/codex-acp"]),
]

const total = (cost: number, input: number, cache_read = 0): UsageTotal => ({
  tokens: { input, cache_read, cache_write: 0, output: 10 },
  sessions: 1,
  prompts: 2,
  requests: 3,
  cost_usd: cost,
  unpriced: 0,
})

const row = (
  day: number,
  harness: string,
  model: string,
  t: UsageTotal
): UsageRow => ({
  day: day * DAY,
  harness,
  model,
  total: t,
})

const rows = [
  row(10, "claude", "opus", total(2, 100, 300)),
  row(10, "work", "opus", total(1, 50)),
  row(12, "codex", "gpt-5", total(0.5, 40, 60)),
]

test("each account keeps the colour of its place in harnesses.toml", () => {
  const accounts = accountsOf(list, ["codex", "claude", "gone"])
  expect(accounts.map((a) => [a.id, a.harness, a.key])).toEqual([
    ["claude", "Claude Code", "a0"],
    ["codex", "Codex", "a2"],
    ["gone", undefined, "a3"],
  ])
  // Work is not shown, and Codex keeps the third colour all the same.
  expect(colourOf(accounts[1]!)).toBe("var(--account-3)")
  const many = accountsOf(
    Array.from({ length: 7 }, (_, i) => view(`h${i}`, `H${i}`, [])),
    ["h6", "h5"]
  )
  expect(many.map(colourOf)).toEqual(["var(--account-1)", "var(--account-2)"])
})

test("the days are each account's values, an empty day too", () => {
  const accounts = accountsOf(list, ["claude", "work", "codex"])
  const days = daysOf(rows, accounts, COST, 10 * DAY + 5, 13 * DAY)
  expect(days).toEqual([
    { day: 10 * DAY, a0: 2, a1: 1, a2: 0 },
    { day: 11 * DAY, a0: 0, a1: 0, a2: 0 },
    { day: 12 * DAY, a0: 0, a1: 0, a2: 0.5 },
  ])
})

test("turning an account off leaves it out of the sums", () => {
  const on = rowsOn(rows, new Set(["claude", "codex"]))
  const sum = totalOf(on)
  expect(sum.cost_usd).toBe(2.5)
  expect(TOKENS(sum)).toBe(100 + 300 + 10 + 40 + 60 + 10)
  expect(sum.prompts).toBe(4)
})

test("by account has shares, by model the accounts that used it", () => {
  const accounts = accountsOf(list, ["claude", "work", "codex"])
  const by = byAccount(rows, accounts, COST)
  expect(by.map((b) => [b.account.id, b.value, b.share])).toEqual([
    ["claude", 2, 2 / 3.5],
    ["work", 1, 1 / 3.5],
    ["codex", 0.5, 0.5 / 3.5],
  ])
  const models = byModel(rows, accounts, COST)
  expect(models.map((m) => [m.model, m.value, m.requests])).toEqual([
    ["opus", 3, 6],
    ["gpt-5", 0.5, 3],
  ])
  expect(models[0]!.accounts.map((a) => a.id)).toEqual(["claude", "work"])
})

test("the cache's hit rate is what was read from it of all read", () => {
  expect(hitRate(total(0, 100, 300).tokens)).toBe(0.75)
  expect(hitRate(total(0, 0, 0).tokens)).toBeUndefined()
})

test("a period asks for whole UTC days, and the one before it while kept", () => {
  const now = 100 * DAY + 6 * 3_600_000
  const week = spanOf("7d", now)
  expect(week.since).toBe(94 * DAY)
  expect(week.before).toEqual({
    since: 94 * DAY - (now - 94 * DAY),
    until: 94 * DAY,
  })
  expect(spanOf("24h", now).since).toBe(now - DAY)
  expect(spanOf("90d", now).before).toBeUndefined()
  expect(deltaOf(118, 100)).toBeCloseTo(0.18)
  expect(deltaOf(5, 0)).toBeUndefined()
})

test("a change past double reads as times as much", () => {
  expect(changeWords(0.18)).toBe("+18%")
  expect(changeWords(-0.4)).toBe("−40%")
  expect(changeWords(1)).toBe("×2")
  expect(changeWords(1.44)).toBe("×2.4")
  expect(changeWords(116.97)).toBe("×118")
})

test("values are written short", () => {
  expect(dollars(9.2)).toBe("$9.20")
  expect(dollars(214.4)).toBe("$214")
  expect(dollars(1520)).toBe("$1.52k")
  expect(count(3_040_000)).toBe("3.0M")
  expect(count(12_400)).toBe("12k")
})

test("the pace word compares the share with even spending", () => {
  const now = 10 * DAY
  const week = {
    id: "w",
    kind: "weekly",
    label: "Weekly",
    lasts: 7 * DAY,
    resets_at: now + 3.5 * DAY,
  } as const
  expect(paceOf({ ...week, used: 80 }, now)?.words).toBe("Ahead of pace")
  expect(paceOf({ ...week, used: 52 }, now)?.words).toBe("On pace")
  expect(paceOf({ ...week, used: 20 }, now)?.words).toBe("Under pace")
  expect(paceOf({ ...week, used: 100 }, now)?.words).toBe("Out")
  expect(paceOf({ ...week, used: 20, lasts: undefined }, now)).toBeUndefined()
})
