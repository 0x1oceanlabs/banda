/**
 * What every part of a Thread reads, from its Thread and not through props
 * (ADR 0091, decision 4): its Project, the Thread, the engine, the other
 * host its Project is on, the image reader, the acts, and which of its
 * sub-agents' rows are open. It holds only what does not change while the
 * Thread is drawn, so it re-renders nothing: the acts keep one identity
 * and call the latest the Thread gave.
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type {
  CrewId,
  Item,
  ListedThread,
  SubagentId,
  TurnView,
} from "@banda/contract/agents"
import type { ImageReader } from "../entries/parts/MessageImages"
import type { Opens } from "./screens"
import { useShownBeside } from "./shown-beside"
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
  /** Puts the Thread off until a time, and with `resume` tries the turn
   * again then (ADR 0074, decision 8); none where it cannot. */
  putOff?: (until: number, resume: boolean) => void
  /** Opens the accounts, in Settings → Agents; none where it cannot. */
  accounts?: () => void
  /** How its Person signs in again, below a turn that failed for that. */
  signIn: (turn: TurnView) => React.ReactNode
  /** Opens a web address on this device, through the router (ADR 0106, law 2). */
  openLink: (url: string) => void
  /** Opens sub-agent `sub` beside: its Pane in the Thread's Group, or the
   * one the Thread has, showing it; in that Pane, one level deeper; where
   * the Thread's Pane is alone, over it, as a screen (ADR 0103, decision
   * 21, {@link useOpens}). None where it cannot. */
  openSubagent?: (sub: SubagentId) => void
  /** Opens Crew `crew` beside, in the Crew Pane, on one of its agents if
   * `agent` names it by its phase and index (ADR 0103, decision 22). None
   * where it cannot. */
  openCrew?: (crew: CrewId, agent?: { phase: number; index: number }) => void
  /** Puts a ready message in the composer, after what is written there,
   * for the Person to send or change: Ask Claude to go on (ADR 0103,
   * decision 26). None where nothing is sent. */
  draft?: (text: string) => void
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
  /** Which sub-agents' rows are open. */
  opened: OpenedRows
}

/**
 * Which sub-agents' rows the Thread has opened in place (ADR 0103,
 * decision 15), kept by the sub-agent and not by its row: a lone row that
 * joins a group as another sub-agent starts beside it is drawn anew, and a
 * group that folds hides its rows, and each opens again as it was left.
 */
export type OpenedRows = {
  has: (sub: SubagentId) => boolean
  set: (sub: SubagentId, open: boolean) => void
  listen: (heard: () => void) => () => void
}

function openedRows(): OpenedRows {
  const open = new Set<SubagentId>()
  const heard = new Set<() => void>()
  return {
    has: (sub) => open.has(sub),
    set: (sub, now) => {
      if (open.has(sub) === now) return
      if (now) open.add(sub)
      else open.delete(sub)
      heard.forEach((hear) => hear())
    },
    listen: (hear) => {
      heard.add(hear)
      return () => void heard.delete(hear)
    },
  }
}

const Around = createContext<ThreadAround | null>(null)

/** What the Thread around this part gives it. */
export function useThreadAround(): ThreadAround {
  const around = useContext(Around)
  if (!around) throw new Error("A Thread's part is drawn in a Thread.")
  return around
}

/** Whether `sub`'s row is lit: the Thread's Pane beside shows it (ADR
 * 0103, decision 21). */
export function useLit(sub: SubagentId): boolean {
  const { project, thread } = useThreadAround()
  return useShownBeside(project, thread) === sub
}

/** How the Thread's sub-agents open from their rows: beside, or over its
 * Pane where it is alone. Apart from the rest, as it changes with the
 * window. */
const OpensOf = createContext<Opens>("beside")

/** How the Thread's sub-agents open from their rows, which their buttons
 * say (`openWords`). */
export function useOpens(): Opens {
  return useContext(OpensOf)
}

/** Whether `sub`'s row is open, and how to open or close it. */
export function useOpened(sub: SubagentId): [boolean, (open: boolean) => void] {
  const { opened } = useThreadAround()
  const open = useSyncExternalStore(opened.listen, () => opened.has(sub))
  return [open, (now) => opened.set(sub, now)]
}

/** Gives a Thread's parts what they read: `acts` may be new on every
 * render, and the parts still see one set; and how its sub-agents open,
 * `opens`, beside by default. */
export function ThreadAroundProvider({
  engine,
  project,
  thread,
  host,
  reader,
  acts,
  opens = "beside",
  children,
}: Omit<ThreadAround, "opened"> & {
  opens?: Opens
  children: React.ReactNode
}) {
  const latest = useRef(acts)
  useLayoutEffect(() => {
    latest.current = acts
  })
  const canPutOff = acts.putOff !== undefined
  const canSet = acts.accounts !== undefined
  const canOpen = acts.openSubagent !== undefined
  const canOpenCrew = acts.openCrew !== undefined
  const canDraft = acts.draft !== undefined
  const stable = useMemo<ThreadActs>(
    () => ({
      openDiff: (turn, path) => latest.current.openDiff(turn, path),
      openVisual: (visual) => latest.current.openVisual(visual),
      openThread: (other) => latest.current.openThread(other),
      fork: (turn) => latest.current.fork(turn),
      rewind: (turn, message) => latest.current.rewind(turn, message),
      retry: (turn) => latest.current.retry(turn),
      retryOn: (turn, harness) => latest.current.retryOn(turn, harness),
      putOff: canPutOff
        ? (until, resume) => latest.current.putOff?.(until, resume)
        : undefined,
      accounts: canSet ? () => latest.current.accounts?.() : undefined,
      signIn: (turn) => latest.current.signIn(turn),
      openLink: (url) => latest.current.openLink(url),
      openSubagent: canOpen
        ? (sub) => latest.current.openSubagent?.(sub)
        : undefined,
      openCrew: canOpenCrew
        ? (crew, agent) => latest.current.openCrew?.(crew, agent)
        : undefined,
      draft: canDraft ? (text) => latest.current.draft?.(text) : undefined,
    }),
    [canPutOff, canSet, canOpen, canOpenCrew, canDraft]
  )
  // Kept by sub-agent IDs, which no other Thread has.
  const [opened] = useState(openedRows)
  const around = useMemo(
    () => ({ engine, project, thread, host, reader, acts: stable, opened }),
    [engine, project, thread, host, reader, stable, opened]
  )
  return (
    <Around.Provider value={around}>
      <OpensOf value={opens}>{children}</OpensOf>
    </Around.Provider>
  )
}
