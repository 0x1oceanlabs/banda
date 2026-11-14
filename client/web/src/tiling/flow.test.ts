import type { Flow } from "@banda/contract/workspaces"
import { afterEach, expect, test, vi } from "vitest"
import { flowHere, picked, Solo } from "./flow"

/** A device's own storage, which outlives a restart of its window. */
function storage(): Storage {
  const kept = new Map<string, string>()
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  } as Storage
}

/**
 * A device's window, started now over `kept`, its own storage: a start
 * again reads what the one before kept. Every window here is on one
 * engine, so they read the same tiling.toml, which says `file`.
 */
function windowOn(kept: Storage) {
  vi.stubGlobal("localStorage", kept)
  const solo = new Solo()
  return {
    /** The Flow it shows, where the file says `file`. */
    shows: (file: Flow) => flowHere(file, solo.get()),
    /** A pick of `flow` in it, by its key or the bar: what it would
     * write to the file, if anything. */
    pick: (flow: Flow, file: Flow) => {
      vi.stubGlobal("localStorage", kept)
      return solo.pick(flow, file)
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

test("a device shows the Flow the file says, and Solo as it chose: its own choice over the Person's default, and never in the Flow free", () => {
  // A device that has not chosen: as the file says, its `solo` the
  // Person's default.
  expect(flowHere("free", undefined)).toBe("free")
  expect(flowHere("row", undefined)).toBe("row")
  expect(flowHere("solo", undefined)).toBe("solo")
  // One that has: its own, over either default.
  expect(flowHere("row", true)).toBe("solo")
  expect(flowHere("solo", false)).toBe("row")
  expect(flowHere("solo", true)).toBe("solo")
  // Solo is a view of the row: free is free on every device.
  expect(flowHere("free", true)).toBe("free")
})

test("a pick of Solo or the row is the device's alone and writes no file; a pick between free and the row writes the file", () => {
  // Solo and back, the file at the row: nothing to write, and back at
  // the default the device follows it again.
  expect(picked("solo", "row", undefined)).toEqual({ solo: true })
  expect(picked("row", "row", true)).toEqual({ solo: undefined })
  // The same over the Person's default of Solo.
  expect(picked("row", "solo", undefined)).toEqual({ solo: false })
  expect(picked("solo", "solo", false)).toEqual({ solo: undefined })
  // Free is how the engine places: the file's, and the device's choice
  // stays for when the row comes back.
  expect(picked("free", "row", true)).toEqual({ solo: true, write: "free" })
  expect(picked("free", "solo", undefined)).toEqual({
    solo: undefined,
    write: "free",
  })
  expect(picked("free", "free", undefined)).toEqual({ solo: undefined })
  // From free, the row comes back with a pick of it or of Solo, which is
  // a view of the row.
  expect(picked("row", "free", true)).toEqual({ solo: undefined, write: "row" })
  expect(picked("solo", "free", undefined)).toEqual({
    solo: true,
    write: "row",
  })
})

test("Solo turned on in one window leaves another on the same engine as it was, and each device has the Solo it had after a restart (ADR 0127, decision 3)", () => {
  const [desk, tab] = [storage(), storage()]
  const first = windowOn(desk)
  const second = windowOn(tab)
  expect(first.shows("row")).toBe("row")
  // Solo here: this device's view, with nothing for the file.
  expect(first.pick("solo", "row")).toBeUndefined()
  expect(first.shows("row")).toBe("solo")
  // The other reads the same file, and is as it was.
  expect(second.shows("row")).toBe("row")
  // Started again, each has the Solo it had.
  expect(windowOn(desk).shows("row")).toBe("solo")
  expect(windowOn(tab).shows("row")).toBe("row")
})

test('`flow = "solo"` in the file is the Person\'s default: a device that has not chosen starts in Solo, and one that chose the row keeps it', () => {
  const [desk, tab] = [storage(), storage()]
  const first = windowOn(desk)
  expect(first.shows("solo")).toBe("solo")
  expect(first.pick("row", "solo")).toBeUndefined()
  expect(first.shows("solo")).toBe("row")
  expect(windowOn(desk).shows("solo")).toBe("row")
  // A new device starts as the Person likes.
  expect(windowOn(tab).shows("solo")).toBe("solo")

  // Back at the default, the device follows it again: the Person's row
  // is then its row, here and after a restart.
  const again = windowOn(desk)
  expect(again.pick("solo", "solo")).toBeUndefined()
  expect(again.shows("solo")).toBe("solo")
  expect(again.shows("row")).toBe("row")
  expect(windowOn(desk).shows("row")).toBe("row")
})

test("a pick of free, and of the row from free, says what the file is to say, and Solo from free takes the row with it", () => {
  const window = windowOn(storage())
  expect(window.pick("free", "row")).toBe("free")
  expect(window.shows("free")).toBe("free")
  expect(window.pick("free", "free")).toBeUndefined()
  expect(window.pick("solo", "free")).toBe("row")
  // Free until the file says the row; then Solo, here alone.
  expect(window.shows("free")).toBe("free")
  expect(window.shows("row")).toBe("solo")
})

test("a device whose storage is out of reach still turns Solo on and off, for as long as its window is open", () => {
  vi.stubGlobal("localStorage", undefined)
  const solo = new Solo()
  expect(solo.pick("solo", "row")).toBeUndefined()
  expect(flowHere("row", solo.get())).toBe("solo")
  expect(flowHere("row", new Solo().get())).toBe("row")
})
