/**
 * The account a new Thread starts on (ADR 0093, decision 7): the default,
 * or the fallback while the default is out and the fallback has room. A
 * Thread the Person put on an account themselves starts there; this is
 * for one they did not.
 */
import { useEffect, useMemo, useState } from "react"
import type { Engine } from "@banda/contract"
import { AGENTS_FILE } from "@banda/contract/agents"
import type {
  AccountList,
  HarnessView,
  Limits,
  LimitsNow,
  LimitWindow,
} from "@banda/contract/harnesses"
import { clock } from "@banda/core/react"
import { MINUTE } from "../lib/words"
import { useAccount, useAccounts } from "./use-harnesses"
import { READ_AGAIN, useMachineLive, type Source } from "./use-live"
import { useNow } from "./use-now"

/** Where a new Thread starts, and why. */
export type StartsOn = {
  /** The entry it starts on. */
  id: string
  /** The default it would start on, as its machine names it (ADR 0108,
   * decision 4). */
  default: string
  /** The default is out: a limit window of it spent, till `until` when
   * every spent window says when it resets. */
  out?: { until?: number; signedOut?: true }
  /** It starts on the fallback, the default being out. */
  fallback: boolean
}

/** The share of a limit window spent now: a window whose reset passed is
 * empty until the next read. */
export function usedOf(window: LimitWindow, now: number): number {
  if (window.resets_at !== undefined && window.resets_at <= now) return 0
  return Math.max(0, Math.min(100, window.used))
}

/** When an account is out, a window of it spent: the last of its spent
 * windows' resets, or none when one says none, and that window's name.
 * Not out: undefined. */
export function outOf(
  limits: Limits | undefined,
  now: number
): { until?: number; window?: string } | undefined {
  const spent = (limits?.windows ?? []).filter((w) => usedOf(w, now) >= 100)
  if (spent.length === 0) return undefined
  const never = spent.find((w) => w.resets_at === undefined)
  if (never) return { window: never.label }
  const last = spent.reduce((a, b) => (b.resets_at! > a.resets_at! ? b : a))
  return { until: last.resets_at, window: last.label }
}

/**
 * Where a new Thread starts among `list`'s entries, by the default and the
 * fallback its machine names, as the `limits` last read: none while it
 * names no default. A fallback with no sign-in confirmed, or out too, is
 * no fallback.
 */
export function startsOn(
  list: Pick<AccountList, "accounts" | "default" | "fallback">,
  limits: readonly Limits[],
  now: number,
  signedIn: ReadonlyMap<string, boolean | undefined> = new Map()
): StartsOn | undefined {
  const first = list.accounts.find((h) => h.id === list.default)
  if (!first) return undefined
  const of = (id: string) => limits.find((l) => l.harness === id)
  const spent = outOf(of(first.id), now)
  const out =
    signedIn.get(first.id) === false
      ? { ...spent, signedOut: true as const }
      : spent
  const base = { id: first.id, default: first.id, out, fallback: false }
  if (!out) return base
  const fallback = list.accounts.find((h) => h.id === list.fallback)
  if (
    !fallback ||
    signedIn.get(fallback.id) !== true ||
    outOf(of(fallback.id), now)
  )
    return base
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
  const out = starts.out.signedOut
    ? `${name(starts.default)} is signed out`
    : `${name(starts.default)} is out${until === undefined ? "" : ` until ${clock(until)}`}`
  if (!starts.fallback)
    return `${out}: new Threads start on it still, as no signed-in fallback has room.`
  const till = starts.out.signedOut
    ? ` till ${name(starts.default)} signs in again`
    : until === undefined
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

/** How many times a machine has told its `agents.toml`, and the `rev` it
 * told last: none before the first. */
export type AgentsTold = { count: number; rev?: string }

/**
 * What `engine`'s machine has told of its `agents.toml` while `on`: first
 * as it is, on every connection, then each time it reads otherwise, by hand
 * or from Settings. What reads the file on that machine reads it again on
 * each.
 */
export function useAgentsTold(engine: Engine, on: boolean): AgentsTold {
  const [told, setTold] = useState<AgentsTold>({ count: 0 })
  useEffect(() => {
    if (!on) return
    return engine.stream(
      undefined,
      "keys.settings_changed",
      {},
      ({ file, rev }) => {
        if (file === AGENTS_FILE.name)
          setTold(({ count }) => ({ count: count + 1, rev }))
      },
      () => {}
    )
  }, [engine, on])
  return told
}

/** Where a new Thread starts now on `engine`'s machine, as {@link
 * startsOn} says from that machine's list and limits; none till the list is
 * read, so a Thread never starts on the first account by being quicker
 * than its machine's answer. */
export function useStartsOn(engine: Engine): StartsOn | undefined {
  const list = useAccounts(engine)
  const { limits, now } = useLimitsNow(engine)
  const primary = useAccount(engine, list?.default)
  const secondary = useAccount(engine, list?.fallback)
  const signedIn = useMemo(
    () =>
      new Map([
        [
          list?.default ?? "",
          primary.state === "ready"
            ? primary.view.account.signed_in_as?.signed_in
            : undefined,
        ],
        [
          list?.fallback ?? "",
          secondary.state === "ready"
            ? secondary.view.account.signed_in_as?.signed_in
            : undefined,
        ],
      ]),
    [list?.default, list?.fallback, primary, secondary]
  )
  return useMemo(
    () => list && startsOn(list, limits, now, signedIn),
    [list, limits, now, signedIn]
  )
}
