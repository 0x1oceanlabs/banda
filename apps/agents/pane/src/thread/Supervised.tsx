/**
 * What a Thread says as Banda keeps it Supervised (ADR 0083): the fence
 * no longer keeps the Full access it was in, so its turn started
 * Supervised. One whose Full access was chosen where the fence held gets
 * a quiet line over the composer, until Dismiss or its next turn ends.
 * Full access from before the fence was nobody's choice, and moves every
 * old Thread at once: one notice on this machine says so, not a line in
 * each.
 */
import { useEffect } from "react"
import type { Fence, ProjectId } from "@banda/contract"
import type { Mode, ThreadId, TurnView } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { kept } from "@banda/ui/lib/kept"
import type { PaneProps } from "@banda/ui/pane"
import { ShieldIcon, XIcon } from "lucide-react"
import { Docked } from "../entries/parts/Card"
import { noticeOf, reasonOf, shortReasonOf } from "../settings/fence"
import type { Supervised } from "./live-thread"

/** A Thread Banda kept Supervised: when, the fence as it found it, and
 * whether its line went, which a Pane that hears it again keeps. */
type Note = { at: number; fence: Fence; gone?: true }

const isNote = (value: unknown): value is Note =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Note).at === "number" &&
  typeof (value as Note).fence === "object"

/** The Threads whose line waits or went, by ID: the Person's own marks,
 * kept in this window's storage. */
const notes = kept("banda.agents.supervised", isNote)

/** The machines whose Person was told that their Threads now start
 * Supervised: once each, not once a Thread. */
const told = kept(
  "banda.agents.supervised-told",
  (value): value is true => value === true
)

/**
 * Keeps what Banda said as it kept `thread` Supervised, once the Pane
 * heard it: a line for the Thread, or the machine's one notice, which the
 * notifications module tells in the main window, whichever window the
 * Thread is in, and its bell shows again (ADR 0056, decision 2).
 */
export function useHeardSupervised(
  thread: ThreadId | null,
  machine: ProjectId | undefined,
  supervised: Supervised | undefined,
  run: PaneProps<unknown>["run"]
) {
  useEffect(() => {
    if (!thread || !supervised || !machine || !run) return
    const { before, fence, at } = supervised
    if (!before) {
      if (notes.read()[thread]?.at !== at) notes.put(thread, { at, fence })
      return
    }
    if (told.read()[machine]) return
    told.put(machine, true)
    run("notifications.tell", noticeOf(fence))
  }, [thread, machine, supervised, run])
}

/**
 * The Thread's line: Started Supervised, why, Learn more and Dismiss. Its
 * next turn that ends puts it away, as Dismiss does, and so does Full
 * access the Person picks again: that choice is theirs (ADR 0083).
 */
export function SupervisedLine({
  thread,
  mode,
  turns,
  onLearn,
}: {
  thread: ThreadId
  mode: Mode | undefined
  turns: readonly TurnView[]
  onLearn: () => void
}) {
  const note = notes.use()[thread]
  // The turn Banda kept Supervised started as it said so; the one after
  // it, once it ended, puts the line away for good, as does Full access
  // the Person picks again.
  const over =
    mode === "full_access" ||
    (note !== undefined &&
      turns.some(
        (turn) =>
          turn.started !== undefined &&
          turn.started > note.at &&
          turn.ended !== undefined
      ))
  useEffect(() => {
    if (over) goes(thread)
  }, [over, thread])
  if (!note || note.gone || over) return null
  return (
    <Docked label="Mode" className="flex items-center gap-2 py-1.5 pr-1.5 pl-4">
      <ShieldIcon className="size-3.75 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-[550]">Started Supervised</span>
      <span
        className="min-w-0 flex-1 truncate text-muted-foreground"
        title={reasonOf(note.fence)}
      >
        {shortReasonOf(note.fence)}
      </span>
      <Button variant="outline" size="xs" onClick={onLearn}>
        Learn more
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => goes(thread)}
      >
        <XIcon />
      </Button>
    </Docked>
  )
}

/** Puts `thread`'s line away for good: the note stays, gone, so the
 * Pane that hears the same turn again does not bring it back. */
function goes(thread: ThreadId) {
  const note = notes.read()[thread]
  if (note && !note.gone) notes.put(thread, { ...note, gone: true })
}
