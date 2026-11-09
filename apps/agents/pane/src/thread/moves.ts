/**
 * Where a started Thread may move (ADR 0078, decisions 4 and 5), as the
 * model picker lists it under the effort slider: the other accounts of
 * its Harness, which go on with its session at one click, and the other
 * Harnesses, which take its history after a confirmation. Pure, so plain
 * tests cover it.
 */
import type { HarnessView, Limits } from "@banda/contract/harnesses"
import { outOf } from "./starts-on"

/** One entry the Thread may move to. */
export type Move = {
  harness: HarnessView
  /** It goes on with the Thread's session: an account of its Harness. */
  same: boolean
  /** The Thread runs on it now. */
  on: boolean
  /** The Thread ran on its Harness before: its session goes on there,
   * and it reads only what it missed. */
  back: boolean
  /** How full its fullest limit window is, in percent; none without
   * limits, as an API key's. */
  fullest?: number
  /** It is out: a window spent, till `until` when that is said. */
  out?: { until?: number }
}

/** The moves of a Thread on `current`, which ran on the entries `ran`:
 * its Harness's accounts first, then the other Harnesses' entries, each
 * in the list's order. Entries turned off are left out. */
export function movesOf(
  harnesses: readonly HarnessView[],
  current: string,
  ran: readonly string[],
  limits: readonly Limits[],
  now: number
): { same: Move[]; others: Move[] } {
  const here = harnesses.find((one) => one.id === current)
  const sessions = here?.sessions ?? current
  const sessionsOf = (id: string) =>
    harnesses.find((one) => one.id === id)?.sessions ?? id
  const before = new Set(ran.map(sessionsOf))
  const moves = harnesses
    .filter((one) => one.enabled || one.id === current)
    .map((harness): Move => {
      const read = limits.find(
        (one) => one.harness === harness.id || one.also?.includes(harness.id)
      )
      const used = read?.windows.map((window) => window.used) ?? []
      return {
        harness,
        same: harness.sessions === sessions,
        on: harness.id === current,
        back: harness.sessions !== sessions && before.has(harness.sessions),
        fullest: used.length > 0 ? Math.round(Math.max(...used)) : undefined,
        out: outOf(read, now),
      }
    })
  return {
    same: moves.filter((move) => move.same),
    others: moves.filter((move) => !move.same),
  }
}

/** The account `step` places from `current` among its Harness's that are
 * not out, round the list: Ctrl+Shift+↑ and ↓. None when there is no
 * other. */
export function stepped(same: readonly Move[], step: 1 | -1): Move | undefined {
  const at = same.findIndex((move) => move.on)
  if (at < 0) return undefined
  for (let n = 1; n < same.length; n++) {
    const move = same[(at + step * n + same.length * n) % same.length]
    if (!move.out) return move
  }
  return undefined
}
