import type { Limits, LimitWindow, UsageNow } from "@banda/contract/harnesses"
import { DAY, HOUR, MINUTE, clock } from "@banda/ui/lib/words"

/** A reset that passed is empty until the engine reads again. */
export function usedOf(window: LimitWindow, now: number): number {
  return window.resets_at !== undefined && window.resets_at <= now
    ? 0
    : Math.max(0, Math.min(100, window.used))
}

export function toneOf(used: number, warn: number): string {
  return used >= 100
    ? "text-destructive"
    : used >= warn
      ? "text-warning"
      : "text-muted-foreground"
}

/** Even spending, only when the provider gave both ends of the window. */
export function elapsedOf(
  window: LimitWindow,
  now: number
): number | undefined {
  if (
    window.resets_at === undefined ||
    !window.lasts ||
    window.resets_at <= now
  )
    return undefined
  return Math.max(
    0,
    Math.min(100, (1 - (window.resets_at - now) / window.lasts) * 100)
  )
}

/** How a window is spent against even spending, as the Usage Pane says
 * it; none without both ends of the window. */
export function paceOf(
  window: LimitWindow,
  now: number
): { words: string; tone: string } | undefined {
  const used = usedOf(window, now)
  if (used >= 100) return { words: "Out", tone: "text-destructive" }
  const elapsed = elapsedOf(window, now)
  if (elapsed === undefined) return undefined
  if (used - elapsed > 5)
    return { words: "Ahead of pace", tone: "text-warning" }
  if (elapsed - used > 5)
    return { words: "Under pace", tone: "text-muted-foreground" }
  return { words: "On pace", tone: "text-muted-foreground" }
}

export function remaining(at: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((at - now) / MINUTE))
  if (minutes >= DAY / MINUTE)
    return `${Math.floor(minutes / (DAY / MINUTE))}d ${Math.floor((minutes % (DAY / MINUTE)) / 60)}h`
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${minutes}m`
}

export function resetWords(window: LimitWindow, now: number): string {
  if (window.resets_at === undefined) return "Reset unknown"
  if (window.resets_at <= now) return "Reset passed · awaiting read"
  return `${usedOf(window, now) >= 100 ? "back in" : "resets in"} ${remaining(window.resets_at, now)}`
}

/** An estimate from the current window's average, never a rate forecast
 * without a start, or after the window ended. */
export function paceWords(
  window: LimitWindow,
  now: number
): string | undefined {
  const elapsed = elapsedOf(window, now)
  const used = usedOf(window, now)
  if (
    window.kind !== "weekly" ||
    elapsed === undefined ||
    elapsed <= 0 ||
    used >= 100 ||
    used - elapsed <= 5
  )
    return undefined
  const out =
    window.resets_at! - window.lasts! + (window.lasts! * elapsed) / used
  return `At this pace, out ${clock(out, now)}, ${remaining(window.resets_at!, out)} early`
}

export function staleOf(limits: Limits, now: number): boolean {
  return (
    limits.failed !== undefined &&
    (limits.read_at === undefined || now - limits.read_at > HOUR / 2)
  )
}

/** The Harnesses Banda reads the limits of, by `Limits.kind`. */
const HARNESSES: Readonly<Record<string, string>> = {
  claude: "Claude Code",
  codex: "Codex",
}

/** Which Harness an account is of: its kind, else its entry's ID. */
export function harnessOf(limits: Limits): string {
  return limits.kind ?? limits.harness
}

/** The Harness's name: `Claude Code`. */
export function harnessName(limits: Limits): string {
  return HARNESSES[harnessOf(limits)] ?? limits.name
}

/** The share spent of an account's fullest window: at 100 the account
 * is out. */
export function fullestOf(limits: Limits, now: number): number {
  return Math.max(0, ...limits.windows.map((w) => usedOf(w, now)))
}

/** The accounts that have windows, by Harness, each Harness where its
 * first account stands. */
export function byHarness(limits: readonly Limits[]): Limits[][] {
  const groups = new Map<string, Limits[]>()
  for (const l of limits) {
    if (l.windows.length === 0) continue
    const group = groups.get(harnessOf(l))
    if (group) group.push(l)
    else groups.set(harnessOf(l), [l])
  }
  return [...groups.values()]
}

/** A Harness's room: its account with the most, and that account's
 * share spent. */
export type Room = { harness: string; best: Limits; share: number }

/** The account with the most room of each Harness (ADR 0055, decision
 * 2): the lowest fullest window, the first of equals. */
export function roomsOf(limits: readonly Limits[], now: number): Room[] {
  return byHarness(limits).map((group) => {
    const best = group.reduce((a, b) =>
      fullestOf(b, now) < fullestOf(a, now) ? b : a
    )
    return { harness: harnessName(best), best, share: fullestOf(best, now) }
  })
}

/** What the widget shows: of the best account of each Harness, the
 * fullest; none while no Harness has windows. */
export function shareOf(
  limits: readonly Limits[],
  now: number
): Room | undefined {
  const rooms = roomsOf(limits, now)
  return rooms.length === 0
    ? undefined
    : rooms.reduce((a, b) => (b.share > a.share ? b : a))
}

/** Whether an account is out while another of its Harness has room: work
 * can go on there, so the widget marks it. */
export function someOut(limits: readonly Limits[], now: number): boolean {
  return byHarness(limits).some(
    (group) =>
      group.some((l) => fullestOf(l, now) >= 100) &&
      group.some((l) => fullestOf(l, now) < 100)
  )
}

/** The entry IDs of the account with the most room of each Harness that
 * has two or more and room left: the popover's "most room". */
export function mostRoomOf(
  limits: readonly Limits[],
  now: number
): Set<string> {
  return new Set(
    byHarness(limits)
      .filter((group) => group.length > 1)
      .flatMap((group) => roomsOf(group, now))
      .filter((room) => room.share < 100)
      .map((room) => room.best.harness)
  )
}

/** When an account that is out has room again: the last reset of its
 * spent windows; none when one of them has no reset. */
export function backAt(limits: Limits, now: number): number | undefined {
  const spent = limits.windows.filter((w) => usedOf(w, now) >= 100)
  if (spent.length === 0 || spent.some((w) => w.resets_at === undefined))
    return undefined
  return Math.max(...spent.map((w) => w.resets_at!))
}

/** "back in 1h 12m", for an account that is out; "out" when its reset is
 * unknown. */
export function backWords(limits: Limits, now: number): string {
  const back = backAt(limits, now)
  return back === undefined ? "out" : `back in ${remaining(back, now)}`
}

/** The accounts' colours, by place in `harnesses.toml`, as the Usage
 * Pane's (ADR 0055, decision 4); dark's until the window has them. */
const ACCOUNT_COLOURS = [
  "#3987e5",
  "#9085e9",
  "#1baf7a",
  "#d55181",
  "#c98500",
] as const

/** The colour of the account at `place`, from 0, in the limits list. */
export function colourOf(place: number): string {
  const n = place % ACCOUNT_COLOURS.length
  return `var(--account-${n + 1}, ${ACCOUNT_COLOURS[n]})`
}

/** A Harness's name short, for the bar: `Claude`. */
export function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

/** The line on hover: each Harness, and for each account its fullest
 * window, or when it has room again. "Claude Code: Personal Weekly 74% ·
 * Work out, back in 1h 12m · Codex: Weekly 4%". */
export function tooltipOf(limits: readonly Limits[], now: number): string {
  return byHarness(limits)
    .map((group) => {
      const harness = harnessName(group[0]!)
      const accounts = group.map((l) => {
        const name = l.name === harness ? "" : `${l.name} `
        const failed = l.failed ? ` (${l.failed.why})` : ""
        if (fullestOf(l, now) >= 100) {
          const back = backWords(l, now)
          return `${name}out${back === "out" ? "" : `, ${back}`}${failed}`
        }
        const fullest = l.windows.reduce((a, b) =>
          usedOf(b, now) > usedOf(a, now) ? b : a
        )
        return `${name}${fullest.label} ${Math.round(usedOf(fullest, now))}%${failed}`
      })
      return `${harness}: ${accounts.join(" · ")}`
    })
    .join(" · ")
}

/** The oldest read of the accounts read: what "Read 2m ago" says. */
export function readAtOf(limits: readonly Limits[]): number | undefined {
  const reads = limits.flatMap((l) =>
    l.read_at === undefined ? [] : [l.read_at]
  )
  return reads.length === 0 ? undefined : Math.min(...reads)
}

/** The popover's foot: "Today · 3.0M tokens · $9.20", from the past
 * day's usage; none while Banda reads no journals, or they hold none. */
export function todayWords(usage: UsageNow | undefined): string | undefined {
  if (!usage?.reading) return undefined
  const { tokens, cost_usd } = usage.total
  const all =
    tokens.input + tokens.cache_read + tokens.cache_write + tokens.output
  if (all === 0) return undefined
  return `Today · ${tokensWords(all)} tokens · $${cost_usd.toFixed(2)}`
}

/** A count of tokens in a few letters: 3.0M, 840k, 12. */
export function tokensWords(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return `${Math.round(n)}`
}
