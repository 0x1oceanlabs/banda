import { expect, test } from "vitest"
import type { Defaults } from "@banda/contract/agents"
import type { Engine } from "@banda/contract"
import type { HarnessView, Limits } from "@banda/contract/harnesses"
import { lastStart, outOf, startOf, startsOn, startsOnWords } from "./starts-on"

const NOW = 1_000_000
const signedIn = new Map([
  ["claude", true],
  ["work", true],
  ["codex", true],
])
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
  expect(startsOn(harnesses, {}, [], NOW, signedIn)?.id).toBe("claude")
  expect(startsOn(harnesses, { account: "work" }, [], NOW, signedIn)?.id).toBe(
    "work"
  )
  const off = [entry("claude", false), entry("work")]
  expect(startsOn(off, { account: "claude" }, [], NOW, signedIn)?.id).toBe(
    "work"
  )
  expect(
    startsOn([entry("claude", false)], {}, [], NOW, signedIn)
  ).toBeUndefined()
})

test("while the default is out, a new Thread starts on the fallback, if it has room", () => {
  const out = [limits("work", 100, NOW + 60_000)]
  const agents = { account: "work", fallback: "codex" }
  expect(startsOn(harnesses, agents, out, NOW, signedIn)).toEqual({
    id: "codex",
    default: "work",
    out: { until: NOW + 60_000, window: "Weekly" },
    fallback: true,
  })
  const both = [...out, limits("codex", 100)]
  expect(startsOn(harnesses, agents, both, NOW, signedIn)?.id).toBe("work")
  expect(startsOn(harnesses, { account: "work" }, out, NOW, signedIn)?.id).toBe(
    "work"
  )
  // Once its window resets, the default has room again.
  expect(startsOn(harnesses, agents, out, NOW + 60_000, signedIn)?.id).toBe(
    "work"
  )
  // A fallback that is off is none.
  const codexOff = [entry("work"), entry("codex", false)]
  expect(startsOn(codexOff, agents, out, NOW, signedIn)?.id).toBe("work")
})

test("an account is out while a window of it is spent, till its last reset", () => {
  expect(outOf(undefined, NOW)).toBeUndefined()
  expect(outOf(limits("a", 99, NOW + 1), NOW)).toBeUndefined()
  expect(outOf(limits("a", 100), NOW)).toEqual({ window: "Weekly" })
  expect(outOf(limits("a", 100, NOW - 1), NOW)).toBeUndefined()
})

test("the settings say where new Threads start while the default is out", () => {
  const agents = { account: "work", fallback: "codex" }
  const out = startsOn(harnesses, agents, [limits("work", 100)], NOW, signedIn)!
  expect(startsOnWords(out, harnesses)).toBe(
    "Work is out: new Threads start on Codex till Work has room."
  )
  const none = startsOn(
    harnesses,
    { account: "work" },
    [limits("work", 100)],
    NOW,
    signedIn
  )!
  expect(startsOnWords(none, harnesses)).toBe(
    "Work is out: new Threads start on it still, as no signed-in fallback has room."
  )
  expect(
    startsOnWords(startsOn(harnesses, agents, [], NOW, signedIn)!, harnesses)
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
    expect(startsOn(harnesses, agents, out, NOW, unknown)?.id).toBe("work")
  }
  const signedOut = new Map([
    ["work", false],
    ["codex", true],
  ])
  const starts = startsOn(harnesses, agents, [], NOW, signedOut)!
  expect(starts.id).toBe("codex")
  expect(startsOnWords(starts, harnesses)).toBe(
    "Work is signed out: new Threads start on Codex till Work signs in again."
  )
  expect(startsOn(harnesses, agents, [], NOW, signedIn)?.id).toBe("work")
  expect(
    startsOn(harnesses, agents, [limits("codex", 100)], NOW, signedOut)?.id
  ).toBe("work")
})

test("a draft starts by the accounts its machine named, once it said them", () => {
  const said = {
    account: "work",
    fallback: "codex",
  } as Partial<Defaults> as Defaults
  expect(startOf(undefined)).toBeUndefined()
  const start = startOf({ claude: said, work: said })
  expect(start).toEqual(said)
  expect(startsOn(harnesses, start!, [], NOW, signedIn)?.id).toBe("work")
  // A machine that names none starts on its first one on.
  const none = startOf({ claude: {} as Partial<Defaults> as Defaults })
  expect(startsOn(harnesses, none!, [], NOW, signedIn)?.id).toBe("claude")
})

test("while its machine has not answered, a draft keeps what that machine named last, and takes nothing from another's", () => {
  const arc = {} as Engine
  const mac = {} as Engine
  expect(lastStart(arc, undefined)).toBeUndefined()
  expect(lastStart(arc, { account: "work" })).toEqual({ account: "work" })
  expect(lastStart(arc, undefined)).toEqual({ account: "work" })
  expect(lastStart(mac, undefined)).toBeUndefined()
  // What it names now wins, naming none too.
  expect(lastStart(arc, {})).toEqual({})
  expect(lastStart(arc, undefined)).toEqual({})
})
