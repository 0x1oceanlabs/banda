/**
 * The account a new Thread starts on (ADR 0093, decision 7): the default,
 * or the fallback while the default is out and the fallback has room. A
 * Thread the Person put on an account themselves starts there; this is
 * for one they did not.
 */
import { useMemo } from "react"
import type { Engine } from "@banda/contract"
import { AGENTS_FILE, type Agents } from "@banda/contract/agents"
import type { HarnessView, Limits, LimitsNow } from "@banda/contract/harnesses"
import { useHarnesses } from "@banda/ui/hooks/use-harnesses"
import {
  READ_AGAIN,
  useMachineLive,
  type Source,
} from "@banda/ui/hooks/use-live"
import { useNow } from "@banda/ui/hooks/use-now"
import { useFile } from "@banda/ui/lib/look"
import { MINUTE, clock } from "@banda/ui/lib/words"

/** Where a new Thread starts, and why. */
export type StartsOn = {
  /** The entry it starts on. */
  id: string
  /** The default it would start on: `agents.toml`'s `start.account`, else
   * the first entry on. */
  default: string
  /** The default is out: a limit window of it spent, till `until` when
   * every spent window says when it resets. */
  out?: { until?: number }
  /** It starts on the fallback, the default being out. */
  fallback: boolean
}

/** When an account is out, a window of it spent: the last of its spent
 * windows' resets, or none when one says none, and that window's name.
 * Not out: undefined. */
export function outOf(
  limits: Limits | undefined,
  now: number
): { until?: number; window?: string } | undefined {
  const spent = (limits?.windows ?? []).filter(
    (w) => w.used >= 100 && !(w.resets_at !== undefined && w.resets_at <= now)
  )
  if (spent.length === 0) return undefined
  const never = spent.find((w) => w.resets_at === undefined)
  if (never) return { window: never.label }
  const last = spent.reduce((a, b) => (b.resets_at! > a.resets_at! ? b : a))
  return { until: last.resets_at, window: last.label }
}

/**
 * Where a new Thread starts among `harnesses`, as `agents` says and the
 * `limits` last read: none while no entry is on. A fallback that is off,
 * gone, the default itself or out too is no fallback.
 */
export function startsOn(
  harnesses: readonly HarnessView[],
  agents: Pick<Agents, "account" | "fallback">,
  limits: readonly Limits[],
  now: number
): StartsOn | undefined {
  const on = harnesses.filter((h) => h.enabled)
  const first = on.find((h) => h.id === agents.account) ?? on[0]
  if (!first) return undefined
  const of = (id: string) => limits.find((l) => l.harness === id)
  const out = outOf(of(first.id), now)
  const base = { id: first.id, default: first.id, out, fallback: false }
  if (!out) return base
  const fallback = on.find((h) => h.id === agents.fallback && h !== first)
  if (!fallback || outOf(of(fallback.id), now)) return base
  return { ...base, id: fallback.id, fallback: true }
}

/** What Settings → Agents says of where new Threads start now: "Work is
 * out until 14:20: new Threads start on Personal until then." None while
 * the default has room. */
export function startsOnWords(
  starts: StartsOn,
  harnesses: readonly HarnessView[]
): string | undefined {
  if (!starts.out) return undefined
  const name = (id: string) => harnesses.find((h) => h.id === id)?.name ?? id
  const until = starts.out.until
  const out = `${name(starts.default)} is out${until === undefined ? "" : ` until ${clock(until)}`}`
  if (!starts.fallback)
    return `${out}: new Threads start on it still, as no fallback has room.`
  const till =
    until === undefined
      ? ` till ${name(starts.default)} has room`
      : " until then"
  return `${out}: new Threads start on ${name(starts.id)}${till}.`
}

const NO_LIMITS: Limits[] = []

/** The machine's limits as last read, read again as they change, and the
 * minute they hold at: each minute, as a reset passes. */
export function useLimitsNow(engine: Engine): {
  limits: readonly Limits[]
  now: number
} {
  const source = useMemo<Source<LimitsNow>>(
    () => ({
      read: () => engine.call("harnesses.limits", {}),
      filter: { module: "harnesses", kinds: ["limits_changed"] },
      apply: () => READ_AGAIN,
    }),
    [engine]
  )
  const now = useNow(MINUTE)
  const live = useMachineLive(engine, source, now)
  const limits = live.state === "ready" ? live.view.limits : NO_LIMITS
  return { limits, now }
}

/** Where a new Thread starts now, as {@link startsOn} says: the Harness
 * list, `agents.toml` and the machine's limits. */
export function useStartsOn(engine: Engine): StartsOn | undefined {
  const harnesses = useHarnesses(engine)
  const { account, fallback } = useFile(AGENTS_FILE)
  const { limits, now } = useLimitsNow(engine)
  return useMemo(
    () => startsOn(harnesses, { account, fallback }, limits, now),
    [harnesses, account, fallback, limits, now]
  )
}
