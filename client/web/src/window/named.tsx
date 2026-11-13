/**
 * Another machine's name and icon in the Tiling's Slot `pane.header`
 * (ADR 0095, decision 7): a Pane of a Project another host has names it
 * after its Project, as the Window's hosts know it, and this machine's
 * only where the Person asked (decision 4); and while the Pane
 * cannot reach that machine, the pill under the header says so, by its
 * icon. No App owns the machines, so it is the Window's own part of the
 * Slot.
 */
import type { ProjectId } from "@banda/contract"
import { MachineIcon, MachineMark } from "@banda/ui/components/machine-icon"
import { seenNamed } from "@banda/ui/hooks/use-status"
import { cn } from "@banda/ui/lib/utils"
import { paneHost, type PaneState } from "@banda/ui/pane"
import type { Filler, HeaderProps } from "@banda/ui/slots"
import { PlayIcon } from "lucide-react"
import { useContext } from "react"
import {
  HostsContext,
  reachWords,
  type Shown,
  useAwayFor,
  useMachineOf,
  useNamedOf,
  useThisNamed,
  useLeftFor,
  useWaitingFor,
} from "@banda/core/react"
import { useLookSidebar } from "../look"

function Named({ project, pane }: { project: ProjectId; pane: PaneState }) {
  const there = useNamedOf(project, paneHost(pane))
  const here = useThisNamed(useLookSidebar().machines.thisToo)
  const named = there ?? here
  return named ? <MachineMark named={named} form="full" /> : null
}

/**
 * The pill over the top of a Pane on host `shown` while the Pane cannot
 * reach it: its icon and the window's words for its state (`reachWords`).
 * Away, it says for how long after them, by the Window's one clock
 * (`useAwayFor`), so every pill and card says the same; a screen reader
 * hears the state as it changes, not each minute. Stopped, it has Start,
 * which starts Banda there: the Person's click alone, as no action does,
 * so no Agent reaches it. It takes the pointer only while it has Start,
 * so it never blocks the Pane under it otherwise. It counts what waits
 * for that machine on this device, from every Thread (ADR 0105, Q3).
 */
export function MachinePill({
  shown,
  onStart,
}: {
  shown: Shown
  onStart: () => void
}) {
  const long = useAwayFor(shown)
  const waiting = useWaitingFor(shown.name).length + useLeftFor(shown.name)
  const words = reachWords(shown.name, shown, seenNamed)
  if (!words) return null
  const stopped = shown.state.state === "stopped"
  return (
    <p
      data-machine-pill={shown.name}
      className={cn(
        "flex max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-tile px-2.5 py-0.5 text-meta whitespace-nowrap text-muted-foreground",
        stopped && "pointer-events-auto"
      )}
    >
      <MachineIcon icon={shown.named.icon} />
      <span className="min-w-0 truncate">
        <span role="status">{words}</span>
        {long && ` · ${long}`}
        {waiting > 0 && (
          <>
            {" · "}
            <span className="text-foreground">{waiting} waiting</span>
          </>
        )}
      </span>
      {stopped && (
        <>
          <span aria-hidden>·</span>
          <button
            type="button"
            className="-mx-1 -my-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-1 py-0.5 font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-muted/50"
            onClick={onStart}
          >
            <PlayIcon className="size-3" />
            Start
          </button>
        </>
      )}
    </p>
  )
}

/** The pill of a Pane of `project` whose args name host `named`, by the
 * machine it is on as the Window shows it now, this one too (ADR 0124);
 * none before the Window knows that machine. */
function Pill({ project, pane }: { project: ProjectId; pane: PaneState }) {
  const kept = useContext(HostsContext)
  const shown = useMachineOf(project, paneHost(pane))?.shown
  return shown ? (
    <MachinePill shown={shown} onStart={() => kept.start(shown.name)} />
  ) : null
}

/** Where the Person writes to another machine, it is named: in the
 * header, and in the pill while the Pane cannot reach it. */
function MachineHeader({ at, project, pane }: HeaderProps) {
  switch (at) {
    case "project":
      return <Named project={project} pane={pane} />
    case "pill":
      return <Pill project={project} pane={pane} />
    default:
      return null
  }
}

export const machineHeader: Filler<"pane.header"> = {
  id: "window.machine",
  slot: "pane.header",
  Fill: MachineHeader,
}
