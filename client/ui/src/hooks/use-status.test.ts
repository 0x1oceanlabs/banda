import type { Engine, Status } from "@banda/contract"
import { MACHINE_NAMED } from "@banda/contract/machines"
import { cleanText, followThisNamed, forgetNamed } from "./use-status"
import { afterEach, expect, test, vi } from "vitest"
import { cleanNamed, followNamed, seenNamed } from "./use-status"

afterEach(() => vi.unstubAllGlobals())

test("another machine's name is cut at 16 characters, with no control or format characters, and drawn as text", () => {
  const name = (said: string) =>
    cleanNamed({ name: said, icon: "server" }, "arc")
  expect(name("studio")).toEqual({ name: "studio", icon: "server" })
  // Sixteen characters, an emoji one of them.
  expect(name("a-very-long-name-of-a-machine").name).toBe("a-very-long-name")
  expect(name("🖥️ studio of roma and more").name).toBe("🖥️ studio of rom")
  // Bidi controls, zero-width spaces and joiners, and control characters
  // go before the cut, so they take none of its room.
  expect(name("‮evil‬​‍⁦x⁩\u0007\n").name).toBe("evilx")
  expect(name("​".repeat(20) + "arc box").name).toBe("arc box")
  // Line and paragraph separators, which would split a title in two.
  expect(name("arc\u2028box\u2029").name).toBe("arcbox")
  // Markup is text.
  expect(name("<b>arc</b>").name).toBe("<b>arc</b>")
})

test("a name left empty is the machine's key in hosts.toml, and an icon not of the ten is desktop", () => {
  expect(cleanNamed({ name: "", icon: "laptop" }, "m1pro")).toEqual({
    name: "m1pro",
    icon: "laptop",
  })
  expect(cleanNamed({ name: " ​‮ ", icon: "vm" }, "m1pro").name).toBe("m1pro")
  expect(cleanNamed({ name: "watch", icon: "watch" }, "m1pro").icon).toBe(
    "desktop"
  )
  for (const said of [undefined, null, "arc", 7, { name: 7, icon: 3 }])
    expect(cleanNamed(said, "m1pro")).toEqual({
      name: "m1pro",
      icon: "desktop",
    })
})

test("other text a machine says of itself, as its system, is cleaned the same way and cut where it is asked", () => {
  expect(cleanText("Arch‮ Linux ", 40)).toBe("Arch Linux")
  expect(cleanText("x".repeat(50), 40)).toHaveLength(40)
  expect(cleanText(null, 40)).toBe("")
  expect(cleanText(7, 40)).toBe("")
})

/** An engine that says what the test tells it: its status, and the
 * pieces of the streams heard. */
function engineSaying() {
  let status: Status = { state: "connecting" }
  const watchers = new Set<(status: Status) => void>()
  const heard: { method: string; onPiece: (piece: unknown) => void }[] = []
  const engine = {
    watch: (watcher: (status: Status) => void) => {
      watchers.add(watcher)
      watcher(status)
      return () => watchers.delete(watcher)
    },
    stream: (
      _project: undefined,
      method: string,
      _params: object,
      onPiece: (piece: unknown) => void
    ) => {
      const one = { method, onPiece }
      heard.push(one)
      return () => heard.splice(heard.indexOf(one), 1)
    },
  } as unknown as Engine
  return {
    engine,
    heard,
    open: (named?: unknown) => {
      status = {
        state: "open",
        engine: "e",
        modules: [],
        boot: "b",
        ...(named !== undefined && { named }),
      } as Status
      for (const watcher of watchers) watcher(status)
    },
  }
}

/** A storage the test reads, in place of the window's. */
function storage() {
  const stored = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  })
  return stored
}

test("a machine taken out is forgotten: added again, it is its key until its first welcome", () => {
  const stored = storage()
  const { engine, open } = engineSaying()
  const stop = followNamed(engine, "box", () => undefined)
  open({ name: "Cloud 2", icon: "tower" })
  stop()
  expect(seenNamed("box")).toEqual({ name: "Cloud 2", icon: "tower" })

  forgetNamed("box")
  expect(seenNamed("box")).toEqual({ name: "box", icon: "desktop" })
  expect(JSON.parse(stored.get("banda.machines.seen")!)).not.toHaveProperty(
    "box"
  )
  // Forgetting one never seen changes nothing.
  forgetNamed("never")
  expect(seenNamed("never")).toEqual({ name: "never", icon: "desktop" })
})

test("this machine's own name and icon come from its welcome and each change, cleaned, and nothing is kept on the device", () => {
  const stored = storage()
  const { engine, heard, open } = engineSaying()
  const took = vi.fn()
  const stop = followThisNamed(engine, took)
  expect(heard.map((one) => one.method)).toEqual([MACHINE_NAMED])
  expect(took).not.toHaveBeenCalled()

  open({ name: "m1pro\u200b", icon: "laptop" })
  expect(took).toHaveBeenLastCalledWith({ name: "m1pro", icon: "laptop" })
  heard[0]!.onPiece({ name: "studio", icon: "toaster" })
  expect(took).toHaveBeenLastCalledWith({ name: "studio", icon: "desktop" })
  expect(stored.size).toBe(0)

  stop()
  expect(heard).toEqual([])
  open({ name: "later", icon: "vm" })
  expect(took).toHaveBeenCalledTimes(2)
})

test("the device keeps the last name and icon it saw of a machine, from its welcome and each change after", () => {
  const stored = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  })
  // Before its first welcome here: its key, with the desktop icon.
  expect(seenNamed("arc")).toEqual({ name: "arc", icon: "desktop" })

  const { engine, heard, open } = engineSaying()
  const took = vi.fn()
  const stop = followNamed(engine, "arc", took)
  expect(heard.map((one) => one.method)).toEqual([MACHINE_NAMED])
  expect(took).not.toHaveBeenCalled()

  open({ name: "arc‮", icon: "server" })
  expect(took).toHaveBeenLastCalledWith({ name: "arc", icon: "server" })
  expect(seenNamed("arc")).toEqual({ name: "arc", icon: "server" })
  expect(JSON.parse(stored.get("banda.machines.seen")!)).toEqual({
    arc: { name: "arc", icon: "server" },
  })

  // Renamed there: the stream says it, cleaned too.
  heard[0]!.onPiece({ name: "studio​", icon: "tower" })
  expect(took).toHaveBeenLastCalledWith({ name: "studio", icon: "tower" })
  expect(seenNamed("arc")).toEqual({ name: "studio", icon: "tower" })
  // An engine that names itself nothing leaves the last one seen.
  open()
  expect(took).toHaveBeenCalledTimes(2)
  expect(seenNamed("arc").name).toBe("studio")
  // Another machine is kept apart.
  expect(seenNamed("devbox")).toEqual({ name: "devbox", icon: "desktop" })

  stop()
  expect(heard).toEqual([])
  open({ name: "later", icon: "vm" })
  expect(took).toHaveBeenCalledTimes(2)
})
