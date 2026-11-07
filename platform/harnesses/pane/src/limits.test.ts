import type { Limits, LimitWindow } from "@banda/contract/harnesses"
import { DAY, HOUR, MINUTE } from "@banda/ui/lib/words"
import { expect, test } from "vitest"
import {
  backWords,
  colourOf,
  elapsedOf,
  mostRoomOf,
  readAtOf,
  roomsOf,
  shareOf,
  shortName,
  someOut,
  todayWords,
  tooltipOf,
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

test("a reset immediately empties the widget and stops its pace estimate", () => {
  expect(usedOf(weekly, now)).toBe(80)
  expect(elapsedOf(weekly, now)).toBe(50)
  expect(paceWords(weekly, now)).toMatch(/^At this pace, out .*, 2d 15h early$/)
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

test("only failed reads older than half an hour dim the widget", () => {
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

const session: LimitWindow = {
  id: "session",
  kind: "session",
  label: "Session",
  used: 38,
  lasts: 5 * HOUR,
  resets_at: now + 2 * HOUR,
}
const account = (
  harness: string,
  name: string,
  kind: string,
  used: [number, number]
): Limits => ({
  harness,
  name,
  kind,
  windows: [
    { ...session, used: used[0], resets_at: now + HOUR + 12 * MINUTE },
    { ...weekly, used: used[1] },
  ],
  read_at: now - 2 * MINUTE,
})
const personal = account("claude", "Personal", "claude", [38, 74])
const work = account("claude-work", "Work", "claude", [100, 46])
const codex = account("codex", "Codex", "codex", [3, 4])

test("the share is the fullest Harness's account with the most room", () => {
  const rooms = roomsOf([personal, work, codex], now)
  expect(rooms.map((r) => [r.harness, r.best.name, r.share])).toEqual([
    ["Claude Code", "Personal", 74],
    ["Codex", "Codex", 4],
  ])
  expect(shareOf([personal, work, codex], now)?.share).toBe(74)
  // Every account of a Harness out: the widget says so.
  expect(shareOf([work, codex], now)?.share).toBe(100)
  expect(shareOf([{ ...codex, windows: [] }], now)).toBeUndefined()
})

test("an account out while another of its Harness has room is marked", () => {
  expect(someOut([personal, work, codex], now)).toBe(true)
  expect(someOut([work, codex], now)).toBe(false)
  expect(someOut([personal, codex], now)).toBe(false)
})

test("most room is said only among two or more accounts with room", () => {
  expect(mostRoomOf([personal, work, codex], now)).toEqual(new Set(["claude"]))
  expect(mostRoomOf([work, { ...work, harness: "w2" }], now).size).toBe(0)
  expect(mostRoomOf([personal, codex], now).size).toBe(0)
})

test("the hover line names each account under its Harness", () => {
  expect(tooltipOf([personal, work, codex], now)).toBe(
    "Claude Code: Personal Weekly 74% · Work out, back in 1h 12m · Codex: Weekly 4%"
  )
  expect(
    tooltipOf([{ ...codex, failed: { at: now, why: "Offline" } }], now)
  ).toBe("Codex: Weekly 4% (Offline)")
  expect(
    backWords(
      { ...work, windows: [{ ...session, used: 100, resets_at: undefined }] },
      now
    )
  ).toBe("out")
})

test("accounts take colours by place, and wrap after five", () => {
  expect(colourOf(0)).toBe("var(--account-1, #3987e5)")
  expect(colourOf(6)).toBe("var(--account-2, #9085e9)")
  expect(shortName("Claude Code")).toBe("Claude")
})

test("the foot says today's usage only while it is read and holds some", () => {
  const usage = {
    at: 0,
    reading: true,
    since: 0,
    until: 0,
    price_revision: "",
    rows: [],
    reads: [],
    total: {
      tokens: { input: 1e6, cache_read: 1.8e6, cache_write: 1e5, output: 1e5 },
      sessions: 3,
      prompts: 9,
      requests: 40,
      cost_usd: 9.2,
      unpriced: 0,
    },
  }
  expect(todayWords(usage)).toBe("Today · 3.0M tokens · $9.20")
  expect(todayWords({ ...usage, reading: false })).toBeUndefined()
  expect(todayWords(undefined)).toBeUndefined()
  expect(readAtOf([personal, { ...codex, read_at: now - HOUR }])).toBe(
    now - HOUR
  )
})
