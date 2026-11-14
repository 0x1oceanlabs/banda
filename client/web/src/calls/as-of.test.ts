import type { ProjectId } from "@banda/contract"
import {
  Cache,
  type DeviceStorage,
  FORGETTING,
  type HostState,
  KeptHosts,
} from "@banda/core"
import { away, deviceStorage, live, project } from "@banda/core/testing"
import type { Listed } from "@banda/ui/pane"
import { afterEach, expect, test, vi } from "vitest"
import { asOf, followRows, ROWS } from "./as-of"
import { markAway, newStores, takeLists } from "./stores"

afterEach(() => {
  vi.useRealTimers()
})

const thread = (id: string, more: Partial<Listed> = {}): Listed => ({
  id,
  title: id,
  mark: "idle",
  changed: 0,
  pane: { kind: "agents.thread", args: { thread: id } },
  ...more,
})

const r1 = "r1" as ProjectId
const connecting: HostState = { name: "arc", ssh: "arc", state: "connecting" }

/** A window on `device`: its hosts, which the test tells, its stores,
 * and the cache following them. */
function windowOn(device: DeviceStorage) {
  const cache = new Cache(() => device)
  const kept = asOf(cache)
  let tell: (hosts: HostState[]) => void = () => undefined
  const hosts = new KeptHosts(
    {
      follow: (take) => {
        tell = take
        return () => undefined
      },
      engine: () => Promise.reject(new Error("not asked")),
      start: () => undefined,
    },
    FORGETTING,
    undefined,
    { asOf: kept.rows }
  )
  hosts.follow()
  const stores = newStores()
  const rows = followRows(hosts, stores, kept, 1_000)
  return { cache, hosts, stores, rows, tell: (all: HostState[]) => tell(all) }
}

test("a window that starts shows a machine's rows as this device kept them, as of then, before it reaches it and while it is away; what the machine lists then takes their place", () => {
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
  const { device } = deviceStorage()
  const first = windowOn(device)
  first.tell([live])
  first.hosts.projects("arc", [project("r1")])
  takeLists(
    first.stores,
    { [r1]: [thread("a"), thread("old", { archived: true })] },
    "arc"
  )
  // Written a while after the change, once for all of it.
  expect(first.cache.read("arc", ROWS)).toBeUndefined()
  vi.advanceTimersByTime(1_000)
  expect(first.cache.read("arc", ROWS)).toEqual({
    at: 11_000,
    value: {
      where: '["arc",null]',
      projects: [project("r1")],
      // Nothing archived.
      lists: { [r1]: [thread("a", { host: "arc" })] },
    },
  })
  first.rows.stop()

  // The window starts again, on its way to arc.
  vi.setSystemTime(500_000)
  const again = windowOn(device)
  again.tell([connecting])
  expect(again.hosts.get()).toEqual([
    {
      name: "arc",
      named: { name: "arc", icon: "desktop" },
      state: connecting,
      away: 11_000,
      asOf: 11_000,
      projects: [project("r1")],
    },
  ])
  const marked = thread("a", { host: "arc", away: true })
  expect(again.stores.items.get()).toEqual({ [r1]: [marked] })

  // arc is away: its rows stand, as of when it was last heard.
  again.tell([away])
  expect(again.hosts.shown("arc")).toMatchObject({
    state: away,
    asOf: 11_000,
    projects: [project("r1")],
  })
  // What stands as last heard is not written again as new.
  vi.advanceTimersByTime(60_000)
  expect(again.cache.read("arc", ROWS)?.at).toBe(11_000)

  // arc is back and lists: its rows are live, and kept as of now.
  again.tell([live])
  expect(again.hosts.shown("arc")?.away).toBeUndefined()
  expect(again.hosts.shown("arc")?.projects).toEqual([project("r1")])
  expect(again.stores.items.get()).toEqual({ [r1]: [marked] })
  takeLists(again.stores, { [r1]: [thread("a"), thread("b")] }, "arc")
  expect(again.stores.items.get()[r1]).toEqual([
    thread("a", { host: "arc" }),
    thread("b", { host: "arc" }),
  ])
  vi.advanceTimersByTime(1_000)
  expect(again.cache.read("arc", ROWS)?.value.lists).toEqual({
    [r1]: [thread("a", { host: "arc" }), thread("b", { host: "arc" })],
  })
  expect(again.cache.read("arc", ROWS)?.at).toBe(561_000)
  again.rows.stop()
})

test("as the window goes, each live machine's rows are kept as of then, though they did not change; an away machine's stay as of when it was heard", () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const one = windowOn(deviceStorage().device)
  one.tell([live, { ...live, name: "box", ssh: "box" }])
  takeLists(one.stores, { [r1]: [thread("a")] }, "arc")
  takeLists(one.stores, {}, "box")
  vi.advanceTimersByTime(1_000)
  expect(one.cache.read("arc", ROWS)?.at).toBe(1_000)

  vi.setSystemTime(90_000)
  one.tell([live, { ...away, name: "box", ssh: "box" }])
  markAway(one.stores, ["box"])
  one.rows.now()
  expect(one.cache.read("arc", ROWS)?.at).toBe(90_000)
  expect(one.cache.read("box", ROWS)?.at).toBe(1_000)
  one.rows.stop()
})

test("a key that goes elsewhere starts with no rows, and a machine gone from hosts.toml, or one that refused, is wiped", () => {
  vi.useFakeTimers()
  const { device } = deviceStorage()
  const first = windowOn(device)
  first.tell([live, { ...live, name: "box", ssh: "box" }])
  first.hosts.projects("arc", [project("r1")])
  takeLists(first.stores, { [r1]: [thread("a")] }, "arc")
  takeLists(first.stores, {}, "box")
  first.rows.stop()
  expect(first.cache.machines().sort()).toEqual(["arc", "box"])

  // arc's key points at another address now: none of the old one's rows.
  const moved = windowOn(device)
  // Before the device told its hosts, nothing is wiped.
  expect(moved.cache.machines().sort()).toEqual(["arc", "box"])
  moved.tell([
    { ...connecting, ssh: "arc.other" },
    { ...connecting, name: "box", ssh: "box" },
  ])
  expect(moved.hosts.shown("arc")?.projects).toEqual([])
  expect(moved.stores.items.get()).toEqual({})
  expect(moved.hosts.shown("box")?.asOf).toBeDefined()

  // box refused this device, and arc is gone from hosts.toml.
  moved.tell([{ name: "box", ssh: "box", state: "refused", why: "revoked" }])
  expect(moved.cache.machines()).toEqual([])
  moved.rows.stop()
})
