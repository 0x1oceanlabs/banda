/**
 * The Mark: Banda's sign at the Bar's left edge, as the Apple menu stands
 * (ADR 0098, decisions 18, 21 and 22).
 *
 *   in    engine     this machine's engine: whether it answers
 *         calls      what the modules' work calls the Person for
 *                    (`barAttention`, the Window's stores)
 *         Quiet      whether the Person put calls off (`useQuiet`)
 *         lists      every Thread's list, for the count (`useInboxCount`)
 *         hosts      the machines, for one away with Agents at work
 *   draws the Mark in the loudest state of the work, a crossed bell while
 *         Quiet is on; while the sidebar is hidden, the count beside it
 *         and the small inbox it opens (the sidebar's `SmallInbox`)
 *   runs  `sidebar.toggle` on the Mark: a click shows or hides the
 *         sidebar, as Alt+A does (decision 21, as amended); the small
 *         inbox runs what its rows do
 *   says  in its name what it shows, "Banda: 3 your turn, 7 at work", and
 *         which machine is away with Agents at work: then it sleeps,
 *         offline (decision 18)
 */
import type { Engine, Status } from "@banda/contract"
import {
  BandaMark,
  loudest,
  type MarkState,
} from "@banda/ui/components/banda-mark"
import { Button } from "@banda/ui/components/button"
import {
  keyNamed,
  namedIn,
  type Shown,
  useHosts,
  useRun,
} from "@banda/core/react"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { useStatus } from "@banda/ui/hooks/use-status"
import type { Lists } from "@banda/ui/pane"
import { awayAtWork } from "@banda/ui/status"
import { BellOffIcon } from "lucide-react"
import { useCallback } from "react"
import { useQuiet } from "../../calls/quiet"
import {
  barAttention,
  useCalls,
  useItems,
  useLaterClock,
} from "../../calls/stores"
import { logoName, logoWords, SmallInbox, useInboxCount } from "../../sidebar"

export function Mark({ engine }: { engine: Engine }) {
  const status = useStatus(engine)
  const keyFor = useKeyLabel()
  const run = useRun()
  const attention = useCalls(barAttention)
  const mark = loudest([attention.mark, markOf(status)])
  const quiet = useQuiet() !== "off"
  const count = useInboxCount()
  const away = useAwayAtWork()
  const words = logoWords(
    mark,
    count,
    quiet,
    status.state === "open" ? away : undefined
  )
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={logoName(words)}
        title={`${keyFor("sidebar.toggle", "Sidebar")}${words && ` · ${words}`}`}
        className="relative"
        onClick={() => run("sidebar.toggle")}
      >
        <BandaMark state={mark} className="size-5" />
        {/* Quiet (ADR 0098, decision 21): at the prototype's corner. */}
        {quiet && (
          <BellOffIcon
            aria-hidden
            data-quiet
            className="absolute -right-1 -bottom-1 size-2.5 text-muted-foreground transition-opacity duration-(--dur-fast) ease-(--ease) starting:opacity-0"
          />
        )}
      </Button>
      <SmallInbox engine={engine} count={count} />
    </>
  )
}

/** Which other machines out of reach had Agents at work, as the Mark's
 * name says them: "arc is away with Agents at work"; none while none. */
function useAwayAtWork(): string | undefined {
  const now = useLaterClock()
  const hosts = useHosts()
  const said = useItems(
    useCallback((lists: Lists) => awayNames(lists, now, hosts), [now, hosts])
  )
  return said || undefined
}

function awayNames(lists: Lists, now: number, hosts: readonly Shown[]): string {
  const names = [...awayAtWork(lists, now).keys()].map(
    (key) => namedIn(hosts, key, keyNamed).name
  )
  if (names.length === 0) return ""
  return `${names.join(", ")} ${names.length === 1 ? "is" : "are"} away with Agents at work`
}

/** The Mark sleeps while the engine does not answer, and fails if it
 * refused. */
function markOf(status: Status): MarkState {
  if (status.state === "open") return "rest"
  return status.state === "refused" ? "failed" : "offline"
}
