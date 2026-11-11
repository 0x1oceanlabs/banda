import { useMemo, useSyncExternalStore } from "react"
import { Refused, type Engine, type ProjectId } from "@banda/contract"
import type {
  AccountList,
  Accounted,
  HarnessView,
} from "@banda/contract/harnesses"
import { type Live, READ_AGAIN, type Source, useMachineLive } from "./use-live"

const NONE: HarnessView[] = []
/** How long to wait before reading again after the connection broke. */
const AGAIN = 500
/** How long the list is followed after its last reader went: rows that
 * mount one by one, as a sidebar's do, share one read. */
const LINGER = 2000
/** What a machine tells as its list of Accounts reads otherwise (ADR
 * 0108, decision 4): a rename too, which is no `account_changed`. */
const LIST_CHANGED = {
  module: "harnesses",
  kinds: ["list_changed"],
}
const LOADING: Live<AccountList> = { state: "loading" }

/** One engine's list, read once for every reader mounted together, and
 * followed while they are. */
type Shared = {
  live: Live<AccountList>
  readers: Set<() => void>
  /** Stops following; none while it is not followed. */
  stop?: () => void
  /** Stops it once no reader came back. */
  lingering?: ReturnType<typeof setTimeout>
}

const shared = new WeakMap<Engine, Shared>()

function of(engine: Engine): Shared {
  let one = shared.get(engine)
  if (!one) {
    one = { live: LOADING, readers: new Set() }
    shared.set(engine, one)
  }
  return one
}

/** The list as `engine`'s machine says it. An engine from before the one
 * answer refuses it as invalid, as it takes nothing that could be; it has
 * only its entries, starts a new Thread on its first one on and names no
 * fallback. Remove once no machine runs an engine from before it. */
async function readList(engine: Engine): Promise<AccountList> {
  try {
    return await engine.call("harnesses.accounts", {})
  } catch (error) {
    if (!(error instanceof Refused) || error.refusal.code !== "invalid")
      throw error
    const accounts = await engine.call("harnesses.list", {})
    const first = accounts.find((one) => one.enabled)?.id
    return { at: 0, accounts, harnesses: [], ...(first && { default: first }) }
  }
}

/** Reads the list, then reads it again each time its machine tells it
 * changed, till stopped: what it reads, every reader sees. A refusal is
 * kept till an answer comes; a broken connection reads again. Away, the
 * last answer stays. */
function follow(engine: Engine, one: Shared): () => void {
  let stopped = false
  let newest = 0
  let machine: ProjectId | undefined
  let unfollow = () => {}
  const show = (live: Live<AccountList>) => {
    one.live = live
    for (const reader of one.readers) reader()
  }
  const read = async (): Promise<void> => {
    const reading = ++newest
    const stale = () => stopped || reading !== newest
    let list: AccountList
    try {
      list = await readList(engine)
    } catch (error) {
      if (stale()) return
      // A refusal after an answer leaves that answer.
      if (error instanceof Refused) {
        if (one.live.state !== "ready")
          show({ state: "refused", refusal: error.refusal })
      } else setTimeout(() => void (stale() || read()), AGAIN)
      return
    }
    if (stale()) return
    show({ state: "ready", view: list })
    unfollow()
    unfollow = machine
      ? engine.follow(
          machine,
          list.at,
          LIST_CHANGED,
          () => void read(),
          () => void (stale() || read())
        )
      : () => {}
  }
  // Read once open, and again on another machine's log.
  let opened = false
  const unwatch = engine.watch((status) => {
    if (status.state !== "open") return
    if (opened && status.machine === machine) return
    opened = true
    machine = status.machine
    void read()
  })
  return () => {
    stopped = true
    unwatch()
    unfollow()
  }
}

/**
 * What `engine`'s machine says of its Accounts (ADR 0108, decision 4): its
 * entries, the Harnesses they are accounts of, and the default and the
 * fallback; followed as that machine tells it changed, and as of its last
 * answer while it is away. The readers mounted together share one read.
 */
export function useAccountList(engine: Engine): Live<AccountList> {
  const one = of(engine)
  const live = useSyncExternalStore(
    (changed) => {
      one.readers.add(changed)
      clearTimeout(one.lingering)
      one.stop ??= follow(engine, one)
      return () => {
        one.readers.delete(changed)
        if (one.readers.size > 0) return
        one.lingering = setTimeout(() => {
          one.stop?.()
          one.stop = undefined
        }, LINGER)
      }
    },
    () => one.live
  )
  return live
}

/** {@link useAccountList}'s answer; none while it loads, or refused. */
export function useAccounts(engine: Engine): AccountList | undefined {
  const live = useAccountList(engine)
  return live.state === "ready" ? live.view : undefined
}

/** The entries of `engine`'s machine, in the order its list names them
 * (the machine's module `harnesses`, ADR 0040); none yet while they load,
 * and none from a list it refused. */
export function useHarnesses(engine: Engine): HarnessView[] {
  return useAccounts(engine)?.accounts ?? NONE
}

/**
 * Who is signed in to `harness`, which asks it, so starts it if need be.
 * It is read again as the machine says its account changed, a sign-in or
 * sign-out anywhere, and at each new `round`, a Person's "check again".
 */
export function useAccount(
  engine: Engine,
  harness: string | undefined,
  round = 0
): Live<Accounted> {
  const source = useMemo<Source<Accounted> | null>(
    () =>
      harness === undefined
        ? null
        : {
            read: () => engine.call("harnesses.account", { harness }),
            filter: {
              module: "harnesses",
              subject: harness,
              kinds: ["account_changed"],
            },
            apply: () => READ_AGAIN,
          },
    [engine, harness]
  )
  return useMachineLive(engine, source, round)
}
