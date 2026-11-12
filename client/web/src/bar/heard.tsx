/**
 * What each machine's engine says of its updates on `updates.state` (ADR
 * 0119, decision 7), as the window heard it last: the bar's widget
 * follows this machine and every host it shows, and Settings → Machines
 * reads the same. A host away keeps what it last said, so its row still
 * names its version.
 */
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import type { Engine } from "@banda/contract"
import type { UpdateState } from "@banda/contract/updates"
import {
  holds,
  HostsContext,
  Store,
  useHereNamed,
  useHosts,
  useStore,
} from "@banda/core/react"
import type { MachineUpdates } from "./machines"

/** What one engine said: its state, or that it answers no
 * `updates.state`. */
export type Heard = { said?: UpdateState; refused?: boolean }

/** What the Window keeps of the updates for its life, one per Window
 * (#863): what each machine said, by machine (`""` for this one, a host
 * by its key), and the last ask to open the widget at a machine, with a
 * count, so the same machine asked again opens it again. */
export type KeptUpdates = {
  heard: Store<ReadonlyMap<string, Heard>>
  opened: Store<{ host?: string; n: number }>
}

const keptUpdates = (): KeptUpdates => ({
  heard: new Store<ReadonlyMap<string, Heard>>(new Map()),
  opened: new Store<{ host?: string; n: number }>({ n: 0 }),
})

const UpdatesContext = createContext<KeptUpdates | null>(null)

/** Keeps the updates for the Window below it. */
export function Updates({ children }: { children: ReactNode }) {
  const [kept] = useState(keptUpdates)
  return <UpdatesContext value={kept}>{children}</UpdatesContext>
}

/** The Window's updates; a part drawn with no Window keeps its own. */
export function useKeptUpdates(): KeptUpdates {
  const [own] = useState(keptUpdates)
  return useContext(UpdatesContext) ?? own
}

/** The key this machine is heard under. */
const HERE = ""

function tell(
  heard: KeptUpdates["heard"],
  key: string,
  now: (was: Heard | undefined) => Heard
) {
  const next = new Map(heard.get())
  next.set(key, now(heard.get().get(key)))
  heard.set(next)
}

/** Follows `engine`'s `updates.state`, under `key`, while it is drawn. */
export function useFollowUpdates(engine: Engine | undefined, key: string) {
  const { heard } = useKeptUpdates()
  useEffect(() => {
    if (!engine) return
    return engine.stream(
      undefined,
      "updates.state",
      {},
      (said) => tell(heard, key, () => ({ said })),
      (refusal) => {
        if (refusal?.code === "not_found")
          tell(heard, key, (was) => ({ ...was, refused: true }))
      }
    )
  }, [engine, key, heard])
}

const itself = <T,>(value: T) => value

/** What every machine said, as heard last. */
export const useHeard = (): ReadonlyMap<string, Heard> =>
  useStore(useKeptUpdates().heard, itself)

/** Opens the bar's widget, at host `host`'s row, as the sidebar's "other
 * build" does (ADR 0119, decision 7). */
export function useOpenUpdates() {
  const { opened } = useKeptUpdates()
  return (host?: string) => opened.set({ host, n: opened.get().n + 1 })
}

/** This machine first, then each host the window shows, with what each
 * said. */
export function useMachineUpdates(): MachineUpdates[] {
  const said = useHeard()
  const here = useHereNamed()
  const hosts = useHosts()
  return useMemo(
    () => [
      {
        name: here?.name ?? "This machine",
        icon: here?.icon ?? "laptop",
        away: false,
        ...said.get(HERE),
      },
      ...hosts
        .filter((host) => holds(host) || said.has(host.name))
        .map((host) => ({
          host: host.name,
          name: host.named.name,
          icon: host.named.icon,
          away: host.state.state !== "live",
          ...said.get(host.name),
        })),
    ],
    [said, here, hosts]
  )
}

/** Follows this machine's engine and each live host's: what the widget
 * draws once, wherever it is. */
export function FollowUpdates({ engine }: { engine: Engine }) {
  useFollowUpdates(engine, HERE)
  const kept = useContext(HostsContext)
  const hosts = useHosts()
  return hosts
    .filter((host) => host.state.state === "live")
    .map((host) => (
      <FollowHost
        key={host.name}
        engine={kept.engine(host.name)}
        host={host.name}
      />
    ))
}

function FollowHost({ engine, host }: { engine: Engine; host: string }) {
  useFollowUpdates(engine, host)
  return null
}

/** The engine a machine's acts go to: this one's, or host `host`'s. */
export function useEngineFor(here: Engine) {
  const kept = useContext(HostsContext)
  return (host: string | undefined) => (host ? kept.engine(host) : here)
}
