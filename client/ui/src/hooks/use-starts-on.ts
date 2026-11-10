/**
 * The account a new Thread starts on (ADR 0093, decision 7): the default,
 * or the fallback while the default is out and the fallback has room. A
 * Thread the Person put on an account themselves starts there; this is
 * for one they did not.
 */
import { useEffect, useMemo, useState } from "react"
import { type Engine, Refused } from "@banda/contract"
import { AGENTS_FILE, type Agents, type Defaults } from "@banda/contract/agents"
import type {
  HarnessView,
  Limits,
  LimitsNow,
  LimitWindow,
} from "@banda/contract/harnesses"
import { clock } from "@banda/core/react"
import { MINUTE } from "../lib/words"
import { useAccount, useHarnesses } from "./use-harnesses"
import { READ_AGAIN, useMachineLive, type Source } from "./use-live"
import { useNow } from "./use-now"

/** The accounts a machine starts a new Thread on, its `agents.toml`'s
 * `[start]`: each machine has its own (ADR 0106, decision 7). */
export type Start = Pick<Agents, "account" | "fallback">

/** Where a new Thread starts, and why. */
export type StartsOn = {
  /** The entry it starts on. */
  id: string
  /** The default it would start on: `agents.toml`'s `start.account`, else
   * the first entry on. */
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
 * Where a new Thread starts among `harnesses`, as `agents` says and the
 * `limits` last read: none while no entry is on. A fallback that is off,
 * gone, the default itself or out too is no fallback.
 */
export function startsOn(
  harnesses: readonly HarnessView[],
  agents: Start,
  limits: readonly Limits[],
  now: number,
  signedIn: ReadonlyMap<string, boolean | undefined> = new Map()
): StartsOn | undefined {
  const on = harnesses.filter((h) => h.enabled)
  const first = on.find((h) => h.id === agents.account) ?? on[0]
  if (!first) return undefined
  const of = (id: string) => limits.find((l) => l.harness === id)
  const spent = outOf(of(first.id), now)
  const out =
    signedIn.get(first.id) === false
      ? { ...spent, signedOut: true as const }
      : spent
  const base = { id: first.id, default: first.id, out, fallback: false }
  if (!out) return base
  const fallback = on.find((h) => h.id === agents.fallback && h !== first)
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

/** The accounts a draft in a Project starts by, from what `agents.defaults`
 * said for each Harness, which names the same ones in each; none till it
 * said. */
export function startOf(
  defaults: Record<string, Defaults> | undefined
): Start | undefined {
  return defaults && Object.values(defaults)[0]
}

const lastNamed = new WeakMap<Engine, Start>()

/**
 * `start` as `engine`'s machine names it now, or while a read is on its
 * way or the machine is away, what it named last: every draft on that
 * machine draws its account at once, and keeps it as the list of Harnesses
 * is read again.
 */
export function lastStart(
  engine: Engine,
  start: Start | undefined
): Start | undefined {
  if (start) lastNamed.set(engine, start)
  return start ?? lastNamed.get(engine)
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

/** How long a read that ran ahead of the machine waits to ask again. */
const AHEAD_WAIT = 100
/** How many times it asks: a file changed with no one to hear it stays
 * ahead, so a draft does not go on asking about it. */
const AHEAD_TRIES = 30

/**
 * What `ask` answers as of `rev`, the machine's last word on its file,
 * asked again till it says that (none: nothing was told yet, so it is
 * taken at once). A read can run ahead of the machine: the file changed,
 * and the machine says so only once its watcher is quiet. When the file
 * goes on to read as it did before, the machine has nothing to say, and
 * what was read ahead would stay; when it stays changed, a next tell is on
 * its way, and the caller asks anew with it. None if `stopped` first.
 */
export async function readAsTold<T extends { rev: string }>(
  ask: () => Promise<T>,
  rev: string | undefined,
  stopped: () => boolean = () => false,
  wait: () => Promise<void> = () =>
    new Promise((done) => setTimeout(done, AHEAD_WAIT))
): Promise<T | undefined> {
  for (let tries = 1; ; tries++) {
    const answer = await ask()
    if (stopped()) return undefined
    if (rev === undefined || answer.rev === rev || tries === AHEAD_TRIES)
      return answer
    await wait()
    if (stopped()) return undefined
  }
}

/**
 * `engine`'s machine's `[start]`, read while `on`, again as it is `told`;
 * for a draft in a Project this is what follows the file, and in No
 * Project, which has no Project to ask `agents.defaults`, it is the only
 * word. None till the machine answers; an engine older than the read names
 * no account.
 */
export function useMachineStart(
  engine: Engine,
  on: boolean,
  told: AgentsTold
): Start | undefined {
  const [read, setRead] = useState<{ engine: Engine; start: Start }>()
  useEffect(() => {
    if (!on) return
    let stopped = false
    const take = (start: Start) => {
      if (!stopped) setRead({ engine, start })
    }
    readAsTold(
      () => engine.call("keys.settings_read", { file: AGENTS_FILE.name }),
      told.rev,
      () => stopped
    ).then(
      (answer) => {
        if (answer) take((answer.values ?? {}) as Start)
      },
      (error: unknown) => {
        // A connection that broke tells the file again as it comes back.
        if (error instanceof Refused) take({})
      }
    )
    return () => {
      stopped = true
    }
  }, [engine, on, told])
  return read?.engine === engine ? read.start : undefined
}

/** Where a new Thread starts now, as {@link startsOn} says: the Harness
 * list and the limits of `engine`'s machine, and that machine's `start`;
 * none till `start` is known, so a Thread never starts on the first account
 * by being quicker than its machine's answer. */
export function useStartsOn(
  engine: Engine,
  start: Start | undefined
): StartsOn | undefined {
  const harnesses = useHarnesses(engine)
  const known = start !== undefined
  const { account, fallback } = start ?? {}
  const { limits, now } = useLimitsNow(engine)
  const first =
    harnesses.find((one) => one.enabled && one.id === account) ??
    harnesses.find((one) => one.enabled)
  const spare = harnesses.find(
    (one) => one.enabled && one.id === fallback && one.id !== first?.id
  )
  const primary = useAccount(engine, first?.id)
  const secondary = useAccount(engine, spare?.id)
  const signedIn = useMemo(
    () =>
      new Map([
        [
          first?.id ?? "",
          primary.state === "ready"
            ? primary.view.account.signed_in_as?.signed_in
            : undefined,
        ],
        [
          spare?.id ?? "",
          secondary.state === "ready"
            ? secondary.view.account.signed_in_as?.signed_in
            : undefined,
        ],
      ]),
    [first?.id, spare?.id, primary, secondary]
  )
  return useMemo(
    () =>
      known
        ? startsOn(harnesses, { account, fallback }, limits, now, signedIn)
        : undefined,
    [known, harnesses, account, fallback, limits, now, signedIn]
  )
}

/** Where a new Thread starts on `engine`'s machine, as that machine's own
 * `agents.toml` says and follows it; none till it answers. */
export function useMachineStartsOn(engine: Engine): StartsOn | undefined {
  const told = useAgentsTold(engine, true)
  const start = useMachineStart(engine, true, told)
  return useStartsOn(engine, lastStart(engine, start))
}
