import type { ProjectId } from "@banda/contract"
import type { Battery } from "@banda/contract/machines"
import { type Shown, Store } from "@banda/core"
import type { Listed } from "@banda/ui/pane"
import { expect, test } from "vitest"
import {
  type Low,
  lowNow,
  lowWords,
  tellLow,
  turnsIn,
  turnsOn,
  turnsSaid,
} from "./battery"
import { newStores, takeLists } from "./stores"

const p = "p" as ProjectId
/** A Project of m1pro's. */
const q = "q" as ProjectId

const thread = (id: string, mark: Listed["mark"]): Listed => ({
  id,
  title: id,
  mark,
  changed: 0,
  pane: { kind: "agents.thread", args: { thread: id } },
})

/** m1pro, live, with `battery`; none for a machine with no battery. */
const m1pro = (battery?: Partial<Battery>, name = "m1pro"): Shown => ({
  name,
  named: { name, icon: "laptop" },
  state: {
    name,
    ssh: name,
    state: "live",
    build: "b",
    version: "0.1.0",
    own: { build: "b", version: "0.1.0" },
  },
  projects: [],
  ...(battery && {
    power: {
      battery: { percent: 50, charging: false, on_power: false, ...battery },
      awake: "working",
    },
  }),
})

const away = (name = "m1pro"): Shown => ({
  name,
  named: { name, icon: "laptop" },
  state: { name, ssh: name, state: "away", why: "ssh ended" },
  away: 0,
  projects: [],
})

test("a machine's running Turns are those at work and those that wait on the Person's Question", () => {
  expect(
    turnsIn({
      [p]: [
        thread("a", "running"),
        thread("b", "thinking"),
        thread("c", "asking"),
        thread("d", "done"),
        thread("e", "idle"),
        thread("f", "failed"),
      ],
    })
  ).toBe(3)
})

test("the warning says the machine, its charge, and how many of its Agents work there", () => {
  const low: Low = { host: "m1pro", name: "m1pro", percent: 12, working: 2 }
  expect(lowWords(low)).toEqual({
    title: "m1pro: 12%, on battery",
    body: "2 Agents work there. Plug it in, or it sleeps as the battery runs out.",
  })
  expect(lowWords({ ...low, working: 1 }).body).toBe(
    "1 Agent works there. Plug it in, or it sleeps as the battery runs out."
  )
})

test("a machine on battery at 20% or less, its Agents at work, is warned of once per discharge", () => {
  const two = () => 2
  const none = () => 0
  // 21%: not yet; 20%, nobody at work: not either.
  let now = lowNow(new Set(), [m1pro({ percent: 21 })], two)
  expect(now.tell).toEqual([])
  now = lowNow(now.warned, [m1pro({ percent: 20 })], none)
  expect(now.tell).toEqual([])
  // 20%, its Agents at work: once.
  now = lowNow(now.warned, [m1pro({ percent: 20 })], two)
  expect(now.tell).toEqual([
    { host: "m1pro", name: "m1pro", percent: 20, working: 2 },
  ])
  // Lower still, away and back still low, on battery, and a reading a
  // little over 20, as a battery's wavers: not again.
  for (const hosts of [
    [m1pro({ percent: 12 })],
    [away()],
    [m1pro({ percent: 12 })],
    [m1pro({ percent: 25 })],
    [m1pro({ percent: 9 })],
  ]) {
    now = lowNow(now.warned, hosts, two)
    expect(now.tell).toEqual([])
    expect(now.plugged).toEqual([])
  }
  // Charging, then on power: its warning goes, and it may warn again.
  now = lowNow(now.warned, [m1pro({ percent: 9, charging: true })], two)
  expect(now.plugged).toEqual(["m1pro"])
  expect(now.warned.size).toBe(0)
  now = lowNow(now.warned, [m1pro({ percent: 15, on_power: true })], two)
  expect(now.plugged).toEqual([])
  now = lowNow(now.warned, [m1pro({ percent: 15 })], two)
  expect(now.tell).toEqual([
    { host: "m1pro", name: "m1pro", percent: 15, working: 2 },
  ])
  // Charged while away, as while it slept on power, and back on battery
  // well over 20: a new discharge, so its warning goes and it may warn
  // again.
  now = lowNow(now.warned, [away()], two)
  expect(now.warned.has("m1pro")).toBe(true)
  now = lowNow(now.warned, [m1pro({ percent: 50 })], two)
  expect(now.plugged).toEqual(["m1pro"])
  expect(now.warned.size).toBe(0)
  now = lowNow(now.warned, [m1pro({ percent: 18 })], two)
  expect(now.tell).toEqual([
    { host: "m1pro", name: "m1pro", percent: 18, working: 2 },
  ])
})

test("Settings and the hover count a machine's Turns only where the window holds its lists", () => {
  const stores = newStores(0)
  // A popped-out window's stores, or before its Watches said: no count.
  expect(turnsSaid(stores, "m1pro")).toBeUndefined()
  expect(turnsOn(stores, "m1pro")).toBe(0)
  takeLists(stores, {}, "m1pro")
  expect(turnsSaid(stores, "m1pro")).toBe(0)
  takeLists(stores, { [q]: [thread("a", "running")] }, "m1pro")
  expect(turnsSaid(stores, "m1pro")).toBe(1)
})

test("each machine is warned of by itself; one with no battery never, and one taken out of hosts.toml has its warning go", () => {
  const working = (host: string) => (host === "devbox" ? 3 : 1)
  let now = lowNow(
    new Set(),
    [m1pro({ percent: 5 }), m1pro(undefined, "devbox"), m1pro({}, "air")],
    working
  )
  expect(now.tell.map((low) => low.host)).toEqual(["m1pro"])
  now = lowNow(
    now.warned,
    [m1pro({ percent: 5 }), m1pro({ percent: 18 }, "air")],
    working
  )
  expect(now.tell.map((low) => low.host)).toEqual(["air"])
  now = lowNow(now.warned, [m1pro({ percent: 17 }, "air")], working)
  expect(now.tell).toEqual([])
  expect(now.plugged).toEqual(["m1pro"])
  expect([...now.warned]).toEqual(["air"])
})

test("the window warns as a machine's battery or its lists change, by its toast, and takes it back once it is on power", () => {
  const stores = newStores(0)
  const hosts = new Store<readonly Shown[]>([m1pro({ percent: 12 })])
  const said: string[] = []
  const stop = tellLow(hosts, stores, {
    show: (key, low) => said.push(`show ${key} ${lowWords(low).title}`),
    hide: (key) => said.push(`hide ${key}`),
  })
  // Low, nobody at work: nothing.
  expect(said).toEqual([])
  // Its Agents start: the lists say so, on that machine.
  takeLists(stores, { [p]: [thread("a", "running")] })
  expect(said).toEqual([])
  takeLists(stores, { [q]: [thread("a", "running")] }, "m1pro")
  expect(said).toEqual(["show battery:m1pro m1pro: 12%, on battery"])
  // Lower, it says nothing more.
  hosts.set([m1pro({ percent: 11 })])
  takeLists(
    stores,
    { [q]: [thread("a", "running"), thread("b", "asking")] },
    "m1pro"
  )
  expect(said).toHaveLength(1)
  // Plugged in, its toast goes.
  hosts.set([m1pro({ percent: 11, charging: true, on_power: true })])
  expect(said.at(-1)).toBe("hide battery:m1pro")
  stop()
  hosts.set([m1pro({ percent: 11 })])
  expect(said).toHaveLength(2)
})
