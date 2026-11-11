/**
 * What a started Thread's "who" picker shows, from what the engine said
 * (ADR 0114, decisions 4 and 8): the account it runs on, and the rows of
 * its menu, its Harness's accounts first, then the other Harnesses. Pure,
 * so plain tests cover it; the picker only draws it.
 */
import type { AccountList, Limits } from "@banda/contract/harnesses"
import type { Move, Moves } from "../thread/moves"

/** One account in the menu. */
export type WhoRow = {
  move: Move
  /** Its plan and its role, as `Max 20x · default`. */
  about: string
  /** How full its fullest limit window is, in percent, while it has room;
   * none when its limits are not read. */
  used?: number
  /** Its use is past the warning threshold. */
  warns: boolean
  /** It is out, back at `until` when that is said. */
  out?: { until?: number }
  /** It cannot be picked: the Thread runs on it, or it is one of its
   * Harness's and out. */
  idle: boolean
}

/** The picker: the account now, and its menu. */
export type Who = {
  now: WhoRow
  /** What its Harness's accounts are grouped under: `Claude Code`. */
  title: string
  same: WhoRow[]
  others: WhoRow[]
  /** A move to another Harness asks first. */
  confirm: boolean
}

/** The picker of a Thread whose `moves` these are, with each account's
 * plan from `limits`, its role from `roles`, and a warning from `warn`
 * percent on. None when the Thread runs on no account in the list. */
export function whoOf(
  moves: Moves,
  roles: Pick<AccountList, "default" | "fallback"> | undefined,
  limits: readonly Limits[],
  warn: number
): Who | undefined {
  const row = (move: Move): WhoRow => {
    const id = move.harness.id
    const read = limits.find(
      (one) => one.harness === id || one.also?.includes(id)
    )
    const role =
      roles?.default === id
        ? "default"
        : roles?.fallback === id
          ? "fallback"
          : undefined
    const used = move.out ? undefined : move.fullest
    return {
      move,
      about: [read?.plan, role].filter(Boolean).join(" · "),
      used,
      warns: used !== undefined && used >= warn,
      out: move.out && { until: move.out.until },
      idle: move.on || (move.same && !!move.out),
    }
  }
  const same = moves.same.map(row)
  const now = same.find((one) => one.move.on)
  if (!now) return undefined
  return {
    now,
    title: moves.title,
    same,
    others: moves.others.map(row),
    confirm: moves.confirm,
  }
}
