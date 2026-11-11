import { afterEach, expect, test, vi } from "vitest"
import {
  choicesAt,
  nineAfter,
  quietAt,
  quietOf,
  Quieting,
  quietWords,
} from "./quiet"

afterEach(() => {
  vi.useRealTimers()
})

const MINUTE = 60_000
/** Wednesday 11 November 2026, at `hour:minute` by the local clock. */
const at = (hour: number, minute = 0, day = 11) =>
  new Date(2026, 10, day, hour, minute).getTime()

/** A device's storage, and its root, as a window has them. */
function device() {
  const kept = new Map<string, string>()
  const said = new Set<string>()
  const heard = new Set<(event: StorageEvent) => void>()
  return {
    kept,
    said,
    storage: () => ({
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    }),
    page: {
      events: {
        addEventListener: (_: string, hear: (event: StorageEvent) => void) =>
          heard.add(hear),
        removeEventListener: (_: string, hear: (event: StorageEvent) => void) =>
          heard.delete(hear),
      } as unknown as Window,
      root: {
        toggleAttribute: (name: string, on?: boolean) => {
          if (on) said.add(name)
          else said.delete(name)
          return Boolean(on)
        },
      },
    },
    /** Another window on the device changed `key`. */
    changed: (key: string | null) => {
      for (const hear of heard) hear({ key } as StorageEvent)
    },
  }
}

test("Quiet until a time is on before it, and off from it", () => {
  const now = at(14)
  expect(quietAt("on", now)).toBe(true)
  expect(quietAt("off", now)).toBe(false)
  expect(quietAt(now + 1, now)).toBe(true)
  expect(quietAt(now, now)).toBe(false)
  // As the device keeps it: past its time, or broken, it is off.
  expect(quietOf("on", now)).toBe("on")
  expect(quietOf(String(now + MINUTE), now)).toBe(now + MINUTE)
  expect(quietOf(String(now - MINUTE), now)).toBe("off")
  expect(quietOf(null, now)).toBe("off")
  expect(quietOf("soon", now)).toBe("off")
})

test("the bell offers 30 minutes, an hour, until 9:00 by the local clock, and until turned off", () => {
  const afternoon = at(14, 20)
  expect(choicesAt(afternoon)).toEqual([
    { words: "30 minutes", quiet: at(14, 50) },
    { words: "1 hour", quiet: at(15, 20) },
    { words: "Until tomorrow 9:00", quiet: at(9, 0, 12) },
    { words: "Until I turn it off", quiet: "on" },
  ])
  // Before 9:00 it is this morning's 9:00.
  expect(choicesAt(at(2, 30))[2]).toEqual({
    words: "Until 9:00",
    quiet: at(9),
  })
  expect(nineAfter(at(8, 59))).toBe(at(9))
  expect(nineAfter(at(9))).toBe(at(9, 0, 12))
  // A month's last day goes on to the next month's first.
  expect(nineAfter(new Date(2026, 10, 30, 22).getTime())).toBe(
    new Date(2026, 11, 1, 9).getTime()
  )
  // Its words: the time it ends, its day too when not today.
  expect(quietWords(at(14, 50), afternoon)).toBe("Quiet until 14:50")
  expect(quietWords("on", afternoon)).toBe("Quiet")
  expect(quietWords("off", afternoon)).toBe("Quiet")
  expect(quietWords(at(9, 0, 12), afternoon)).toMatch(/^Quiet until \w+ 9:00$/)
})

test("Quiet ends on its time: the page says it no more, and the device keeps it no more", () => {
  vi.useFakeTimers({ now: at(14) })
  const { kept, said, storage, page } = device()
  const quiet = new Quieting(storage)
  const stop = quiet.follow(page)
  expect(quiet.get()).toBe("off")
  const heard = vi.fn()
  quiet.subscribe(heard)

  quiet.turn(at(14, 30))
  expect(quiet.on()).toBe(true)
  expect(said.has("data-quiet")).toBe(true)
  expect(kept.get("banda.quiet")).toBe(String(at(14, 30)))
  expect(heard).toHaveBeenCalledTimes(1)

  vi.advanceTimersByTime(30 * MINUTE - 1)
  expect(quiet.on()).toBe(true)
  vi.advanceTimersByTime(1)
  expect(quiet.get()).toBe("off")
  expect(said.has("data-quiet")).toBe(false)
  expect(kept.has("banda.quiet")).toBe(false)
  expect(heard).toHaveBeenCalledTimes(2)

  // Until turned off, it lasts, and Turn off ends it.
  quiet.turn("on")
  vi.advanceTimersByTime(48 * 60 * MINUTE)
  expect(quiet.get()).toBe("on")
  quiet.turn("off")
  expect(said.has("data-quiet")).toBe(false)
  expect(kept.has("banda.quiet")).toBe(false)
  stop()
})

test("a machine asleep past Quiet's end turns it off within a minute of waking", () => {
  vi.useFakeTimers({ now: at(14) })
  const { said, storage, page } = device()
  const quiet = new Quieting(storage)
  quiet.follow(page)
  quiet.turn(at(14, 30))
  // Two hours asleep, which no timer counts.
  vi.setSystemTime(at(16))
  expect(quiet.on()).toBe(false)
  vi.advanceTimersByTime(MINUTE)
  expect(quiet.get()).toBe("off")
  expect(said.has("data-quiet")).toBe(false)
})

test("Quiet outlives a restart, until its time, and another window on the device hears it change", () => {
  vi.useFakeTimers({ now: at(14) })
  const { kept, said, storage, page, changed } = device()
  new Quieting(storage).turn(at(15))

  // A restart: a new window reads what the device kept.
  const again = new Quieting(storage)
  again.follow(page)
  expect(again.get()).toBe(at(15))
  expect(said.has("data-quiet")).toBe(true)

  // Another window turns it off, then on until turned off.
  kept.delete("banda.quiet")
  changed("banda.quiet")
  expect(again.get()).toBe("off")
  kept.set("banda.quiet", "on")
  changed(null)
  expect(again.get()).toBe("on")
  // What else it keeps does not matter.
  changed("banda.sidebar.someday")
  expect(again.get()).toBe("on")

  // Past its time, a restart finds it off.
  kept.set("banda.quiet", String(at(13)))
  const later = new Quieting(storage)
  later.follow(page)
  expect(later.get()).toBe("off")
})

test("a device that keeps nothing keeps Quiet for the window's life", () => {
  vi.useFakeTimers({ now: at(14) })
  const quiet = new Quieting(() => {
    throw new Error("no storage")
  })
  quiet.follow(device().page)
  quiet.turn("on")
  expect(quiet.get()).toBe("on")
})
