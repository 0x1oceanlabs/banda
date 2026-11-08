/**
 * What every part of a Thread reads, from its Thread and not through props
 * (ADR 0091, decision 4): its Project, the Thread, the engine, the other
 * host its Project is on, the image reader, and the acts. It holds only
 * what does not change while the Thread is drawn, so it re-renders
 * nothing: the acts keep one identity and call the latest the Thread
 * gave.
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { Item, ListedThread, TurnView } from "@banda/contract/agents"
import type { ImageReader } from "../entries/parts/MessageImages"
import type { VisualArgs } from "../visual/Frame"

/** What a part of the Thread may ask, named for what it asks, not for who
 * does it: the Pane answers today, `pane.pick` and intents later (ADR
 * 0087, decision 7). */
export type ThreadActs = {
  /** Opens a turn's changes, on one file if `path` names it. */
  openDiff: (turn: string, path?: string) => void
  /** Opens a Visual as a Pane of its own, beside the Thread. */
  openVisual: (visual: VisualArgs) => void
  /** Opens another Thread, one whose Agent wrote here. */
  openThread: (thread: ListedThread) => void
  /** Forks the Thread at the end of `turn`. */
  fork: (turn: TurnView) => void
  /** Takes the Thread back to before `message`, which `turn` ran first. */
  rewind: (turn: TurnView, message: Item) => void
  /** Sends `turn`'s message again. */
  retry: (turn: TurnView) => void
  /** Moves the Thread to account `harness`, then sends `turn`'s message
   * again there: the Person's click on a limit's card (ADR 0093,
   * decision 8). */
  retryOn: (turn: TurnView, harness: string) => void
  /** Snoozes the Thread until a time, and with `resume` tries the turn
   * again then (ADR 0074, decision 8); none where it cannot. */
  snooze?: (until: number, resume: boolean) => void
  /** How its Person signs in again, below a turn that failed for that. */
  signIn: (turn: TurnView) => React.ReactNode
}

export type ThreadAround = {
  engine: Engine
  project: ProjectId
  thread: string
  /** The other host of `hosts.toml` its Project is on (ADR 0081): what
   * this machine would draw from its Project, as a Visual, is not there
   * yet. None for this machine's. */
  host?: string
  reader: ImageReader
  acts: ThreadActs
}

const Around = createContext<ThreadAround | null>(null)

/** What the Thread around this part gives it. */
export function useThreadAround(): ThreadAround {
  const around = useContext(Around)
  if (!around) throw new Error("A Thread's part is drawn in a Thread.")
  return around
}

/** Gives a Thread's parts what they read: `acts` may be new on every
 * render, and the parts still see one set. */
export function ThreadAroundProvider({
  engine,
  project,
  thread,
  host,
  reader,
  acts,
  children,
}: ThreadAround & { children: React.ReactNode }) {
  const latest = useRef(acts)
  useLayoutEffect(() => {
    latest.current = acts
  })
  const snoozes = acts.snooze !== undefined
  const stable = useMemo<ThreadActs>(
    () => ({
      openDiff: (turn, path) => latest.current.openDiff(turn, path),
      openVisual: (visual) => latest.current.openVisual(visual),
      openThread: (other) => latest.current.openThread(other),
      fork: (turn) => latest.current.fork(turn),
      rewind: (turn, message) => latest.current.rewind(turn, message),
      retry: (turn) => latest.current.retry(turn),
      retryOn: (turn, harness) => latest.current.retryOn(turn, harness),
      snooze: snoozes
        ? (until, resume) => latest.current.snooze?.(until, resume)
        : undefined,
      signIn: (turn) => latest.current.signIn(turn),
    }),
    [snoozes]
  )
  const around = useMemo(
    () => ({ engine, project, thread, host, reader, acts: stable }),
    [engine, project, thread, host, reader, stable]
  )
  return <Around.Provider value={around}>{children}</Around.Provider>
}
