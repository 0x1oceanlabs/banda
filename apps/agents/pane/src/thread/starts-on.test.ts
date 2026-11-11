import { expect, test } from "vitest"
import type { HarnessView, Limits } from "@banda/contract/harnesses"
import { outOf, startsOn, startsOnWords } from "./starts-on"

const NOW = 1_000_000
const signedIn = new Map([
  ["claude", true],
  ["work", true],
  ["codex", true],
])
const entry = (id: string, enabled = true) =>
  ({ id, name: id[0]!.toUpperCase() + id.slice(1), enabled }) as HarnessView
const harnesses = [entry("claude"), entry("work"), entry("codex")]
/** The list as its machine says it: it names the default and the
 * fallback, and has made sure both are on and not the same. */
const listOf = (
  accounts: HarnessView[],
  roles: { account?: string; fallback?: string }
) => ({ accounts, default: roles.account, fallback: roles.fallback })
const limits = (harness: string, used: number, resets_at?: number) =>
  ({
    harness,
    name: harness,
    windows: [{ id: "week", kind: "weekly", label: "Weekly", used, resets_at }],
  }) as Limits

test("a new Thread starts on the default its machine names, none while it names none", () => {
  expect(
    startsOn(listOf(harnesses, { account: "work" }), [], NOW, signedIn)?.id
  ).toBe("work")
  expect(startsOn(listOf(harnesses, {}), [], NOW, signedIn)).toBeUndefined()
})

test("while the default is out, a new Thread starts on the fallback, if it has room", () => {
  const out = [limits("work", 100, NOW + 60_000)]
  const agents = { account: "work", fallback: "codex" }
  expect(startsOn(listOf(harnesses, agents), out, NOW, signedIn)).toEqual({
    id: "codex",
    default: "work",
    out: { until: NOW + 60_000, window: "Weekly" },
    fallback: true,
  })
  const both = [...out, limits("codex", 100)]
  expect(startsOn(listOf(harnesses, agents), both, NOW, signedIn)?.id).toBe(
    "work"
  )
  expect(
    startsOn(listOf(harnesses, { account: "work" }), out, NOW, signedIn)?.id
  ).toBe("work")
  // Once its window resets, the default has room again.
  expect(
    startsOn(listOf(harnesses, agents), out, NOW + 60_000, signedIn)?.id
  ).toBe("work")
})

test("an account is out while a window of it is spent, till its last reset", () => {
  expect(outOf(undefined, NOW)).toBeUndefined()
  expect(outOf(limits("a", 99, NOW + 1), NOW)).toBeUndefined()
  expect(outOf(limits("a", 100), NOW)).toEqual({ window: "Weekly" })
  expect(outOf(limits("a", 100, NOW - 1), NOW)).toBeUndefined()
})

test("the settings say where new Threads start while the default is out", () => {
  const agents = { account: "work", fallback: "codex" }
  const out = startsOn(
    listOf(harnesses, agents),
    [limits("work", 100)],
    NOW,
    signedIn
  )!
  expect(startsOnWords(out, harnesses)).toBe(
    "Work is out: new Threads start on Codex till Work has room."
  )
  const none = startsOn(
    listOf(harnesses, { account: "work" }),
    [limits("work", 100)],
    NOW,
    signedIn
  )!
  expect(startsOnWords(none, harnesses)).toBe(
    "Work is out: new Threads start on it still, as no signed-in fallback has room."
  )
  expect(
    startsOnWords(
      startsOn(listOf(harnesses, agents), [], NOW, signedIn)!,
      harnesses
    )
  ).toBeUndefined()
})

test("fallback requires a confirmed sign-in and also covers a signed-out default", () => {
  const agents = { account: "work", fallback: "codex" }
  const out = [limits("work", 100)]
  for (const status of [undefined, false]) {
    const unknown = new Map([
      ["work", true],
      ["codex", status],
    ])
    expect(startsOn(listOf(harnesses, agents), out, NOW, unknown)?.id).toBe(
      "work"
    )
  }
  const signedOut = new Map([
    ["work", false],
    ["codex", true],
  ])
  const starts = startsOn(listOf(harnesses, agents), [], NOW, signedOut)!
  expect(starts.id).toBe("codex")
  expect(startsOnWords(starts, harnesses)).toBe(
    "Work is signed out: new Threads start on Codex till Work signs in again."
  )
  expect(startsOn(listOf(harnesses, agents), [], NOW, signedIn)?.id).toBe(
    "work"
  )
  expect(
    startsOn(listOf(harnesses, agents), [limits("codex", 100)], NOW, signedOut)
      ?.id
  ).toBe("work")
})
