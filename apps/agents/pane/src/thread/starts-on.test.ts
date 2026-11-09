import { expect, test } from "vitest"
import type { HarnessView, Limits } from "@banda/contract/harnesses"
import { outOf, startsOn, startsOnWords } from "./starts-on"

const NOW = 1_000_000
const entry = (id: string, enabled = true) =>
  ({ id, name: id[0]!.toUpperCase() + id.slice(1), enabled }) as HarnessView
const harnesses = [entry("claude"), entry("work"), entry("codex")]
const limits = (harness: string, used: number, resets_at?: number) =>
  ({
    harness,
    name: harness,
    windows: [{ id: "week", kind: "weekly", label: "Weekly", used, resets_at }],
  }) as Limits

test("a new Thread starts on the default: the one start names, else the first on", () => {
  expect(startsOn(harnesses, {}, [], NOW)?.id).toBe("claude")
  expect(startsOn(harnesses, { account: "work" }, [], NOW)?.id).toBe("work")
  const off = [entry("claude", false), entry("work")]
  expect(startsOn(off, { account: "claude" }, [], NOW)?.id).toBe("work")
  expect(startsOn([entry("claude", false)], {}, [], NOW)).toBeUndefined()
})

test("while the default is out, a new Thread starts on the fallback, if it has room", () => {
  const out = [limits("work", 100, NOW + 60_000)]
  const agents = { account: "work", fallback: "codex" }
  expect(startsOn(harnesses, agents, out, NOW)).toEqual({
    id: "codex",
    default: "work",
    out: { until: NOW + 60_000 },
    fallback: true,
  })
  const both = [...out, limits("codex", 100)]
  expect(startsOn(harnesses, agents, both, NOW)?.id).toBe("work")
  expect(startsOn(harnesses, { account: "work" }, out, NOW)?.id).toBe("work")
  // Once its window resets, the default has room again.
  expect(startsOn(harnesses, agents, out, NOW + 60_000)?.id).toBe("work")
  // A fallback that is off is none.
  const codexOff = [entry("work"), entry("codex", false)]
  expect(startsOn(codexOff, agents, out, NOW)?.id).toBe("work")
})

test("an account is out while a window of it is spent, till its last reset", () => {
  expect(outOf(undefined, NOW)).toBeUndefined()
  expect(outOf(limits("a", 99, NOW + 1), NOW)).toBeUndefined()
  expect(outOf(limits("a", 100), NOW)).toEqual({})
  expect(outOf(limits("a", 100, NOW - 1), NOW)).toBeUndefined()
})

test("the settings say where new Threads start while the default is out", () => {
  const agents = { account: "work", fallback: "codex" }
  const out = startsOn(harnesses, agents, [limits("work", 100)], NOW)!
  expect(startsOnWords(out, harnesses)).toBe(
    "Work is out: new Threads start on Codex till Work has room."
  )
  const none = startsOn(
    harnesses,
    { account: "work" },
    [limits("work", 100)],
    NOW
  )!
  expect(startsOnWords(none, harnesses)).toBe(
    "Work is out: new Threads start on it still, as no fallback has room."
  )
  expect(
    startsOnWords(startsOn(harnesses, agents, [], NOW)!, harnesses)
  ).toBeUndefined()
})
