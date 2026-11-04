import type { Limits, LimitWindow } from "@banda/contract/harnesses"
import { DAY, HOUR, MINUTE } from "@banda/ui/lib/words"
import { expect, test } from "vitest"
import {
  elapsedOf,
  paceWords,
  remaining,
  resetWords,
  staleOf,
  toneOf,
  usedOf,
} from "./limits"

const now = 10 * DAY
const weekly: LimitWindow = {
  id: "week",
  kind: "weekly",
  label: "Weekly",
  used: 80,
  lasts: 7 * DAY,
  resets_at: now + 3.5 * DAY,
}

test("a reset immediately empties the ring and stops its pace estimate", () => {
  expect(usedOf(weekly, now)).toBe(80)
  expect(elapsedOf(weekly, now)).toBe(50)
  expect(paceWords(weekly, now)).toContain("before it resets")
  const reset = weekly.resets_at!
  expect(usedOf(weekly, reset)).toBe(0)
  expect(elapsedOf(weekly, reset)).toBeUndefined()
  expect(paceWords(weekly, reset)).toBeUndefined()
  expect(resetWords(weekly, reset)).toContain("awaiting read")
})

test("pace needs a known start and a week ahead of even spending", () => {
  expect(paceWords({ ...weekly, used: 54 }, now)).toBeUndefined()
  expect(paceWords({ ...weekly, used: 100 }, now)).toBeUndefined()
  expect(elapsedOf({ ...weekly, lasts: undefined }, now)).toBeUndefined()
  expect(paceWords({ ...weekly, resets_at: undefined }, now)).toBeUndefined()
  expect(elapsedOf(weekly, now - 10 * DAY)).toBe(0)
})

test("warnings respect the configured threshold and a full window is always red", () => {
  expect(toneOf(79, 80)).toBe("text-muted-foreground")
  expect(toneOf(80, 80)).toBe("text-warning")
  expect(toneOf(80, 90)).toBe("text-muted-foreground")
  expect(toneOf(100, 100)).toBe("text-destructive")
  expect(usedOf({ ...weekly, used: 110 }, now)).toBe(100)
})

test("only failed reads older than half an hour dim the ring", () => {
  const limits: Limits = {
    harness: "codex",
    name: "Codex",
    windows: [weekly],
    read_at: now - HOUR,
  }
  expect(staleOf(limits, now)).toBe(false)
  expect(staleOf({ ...limits, failed: { at: now, why: "Offline" } }, now)).toBe(
    true
  )
  expect(
    staleOf(
      { ...limits, read_at: now, failed: { at: now, why: "Offline" } },
      now
    )
  ).toBe(false)
})

test("reset words handle full, unknown and minute boundaries", () => {
  expect(resetWords({ ...weekly, used: 100 }, now)).toBe("back in 3d 12h")
  expect(resetWords({ ...weekly, resets_at: undefined }, now)).toBe(
    "Reset unknown"
  )
  expect(remaining(now + HOUR + 14 * MINUTE, now)).toBe("1h 14m")
})
