import { DAY, HOUR, MINUTE } from "@banda/ui/lib/words"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { dueOf, newClock, nextClock, nextOf, type Page } from "./clock"

/** Tuesday, 10 November 2026, 15:00 by the local clock. */
const NOW = new Date(2026, 10, 10, 15, 0).getTime()

describe("when a card's time next changes", () => {
  test("a short time, by its steps (words.test.ts)", () => {
    expect(nextOf({ kind: "ago", at: NOW - 30_000 }, NOW)).toBe(NOW + 10_000)
    expect(nextOf({ kind: "ago", at: NOW - 14 * MINUTE }, NOW)).toBe(
      NOW + MINUTE
    )
    expect(nextOf({ kind: "ago", at: NOW - 3 * HOUR }, NOW)).toBe(NOW + HOUR)
  })

  test("a wake time changes at midnight, and as it comes within the week", () => {
    const tonight = new Date(2026, 10, 10, 18, 30).getTime()
    expect(nextClock(tonight, NOW)).toBe(new Date(2026, 10, 11).getTime())
    const far = NOW + 9 * DAY
    expect(nextClock(far, NOW)).toBe(new Date(2026, 10, 11).getTime())
    const soon = new Date(2026, 10, 16, 20, 0).getTime()
    expect(nextClock(soon, new Date(2026, 10, 10, 19, 0).getTime())).toBe(
      soon - 6 * DAY
    )
  })

  test("a Later with no time never changes; of several times, the first", () => {
    expect(nextOf({ kind: "someday" }, NOW)).toBeUndefined()
    expect(nextOf({ kind: "when done" }, NOW)).toBeUndefined()
    expect(
      dueOf(
        [
          { kind: "someday" },
          { kind: "ago", at: NOW - 3 * HOUR },
          { kind: "ago", at: NOW - 30_000 },
        ],
        NOW
      )
    ).toBe(NOW + 10_000)
    expect(dueOf([{ kind: "when done" }], NOW)).toBeUndefined()
  })
})

describe("the list's one clock", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test("one timer wakes each card as its moment comes, and only then", () => {
    const clock = newClock()
    const woke: string[] = []
    clock.wakeAt(NOW + 10_000, () => woke.push("ten"))
    clock.wakeAt(NOW + MINUTE, () => woke.push("minute"))
    clock.wakeAt(NOW + 10_000, () => woke.push("ten too"))
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(9_999)
    expect(woke).toEqual([])
    vi.advanceTimersByTime(1)
    expect(woke).toEqual(["ten", "ten too"])
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(MINUTE)
    expect(woke).toEqual(["ten", "ten too", "minute"])
    expect(vi.getTimerCount()).toBe(0)
  })

  test("a card that stops waiting is not woken, and with none left no timer runs", () => {
    const clock = newClock()
    const wake = vi.fn()
    const stop = clock.wakeAt(NOW + 10_000, wake)
    stop()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(20_000)
    expect(wake).not.toHaveBeenCalled()
  })

  test("a moment that passed wakes at once; a far one is waited for in steps", () => {
    const clock = newClock()
    const passed = vi.fn()
    clock.wakeAt(NOW - 1, passed)
    vi.advanceTimersByTime(0)
    expect(passed).toHaveBeenCalledWith(NOW)
    const far = vi.fn()
    clock.wakeAt(NOW + 3 * DAY, far)
    vi.advanceTimersByTime(HOUR)
    expect(far).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(3 * DAY)
    expect(far).toHaveBeenCalledTimes(1)
  })

  test("it sleeps while the page is hidden, and shown again wakes what passed", () => {
    let hidden = false
    let changed = () => {}
    const page: Page = {
      hidden: () => hidden,
      onChange: (heard) => (changed = heard),
    }
    const clock = newClock(page)
    const wake = vi.fn()
    clock.wakeAt(NOW + 10_000, wake)
    hidden = true
    changed()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(MINUTE)
    expect(wake).not.toHaveBeenCalled()
    hidden = false
    changed()
    expect(wake).toHaveBeenCalledWith(NOW + MINUTE)
  })
})
