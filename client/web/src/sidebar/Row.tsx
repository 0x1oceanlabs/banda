import { ThreadMark } from "@banda/ui/components/banda-mark"
import type { Named } from "@banda/contract/machines"
import { Emblem, emblemOf, type EmblemOf } from "@banda/ui/components/emblem"
import { MachineMark } from "@banda/ui/components/machine-icon"
import { ProjectName, ProjectSign } from "@banda/ui/components/project-sign"
import { DiamondIcon } from "lucide-react"
import { Fragment, type ReactNode } from "react"
import { cn } from "@banda/ui/lib/utils"
import type { Row as Arranged } from "./arrange"
import { type Card, cardOf, type Slot } from "./card"
import { Status, TONES } from "./CardStatus"
import { MachineCard } from "./MachineCard"
import { useOpenRow } from "./open"
import type { Settings } from "./settings"
import { THINKING, useThinking } from "@banda/ui/lib/naming"

const NO_HARNESSES: readonly EmblemOf[] = []

/** One row of the sidebar, its parts laid out as the settings say; a
 * click opens the Pane it stands for, by `pane.pick`. */
export function Row({
  row,
  settings,
  inProject,
  current,
  away,
  action,
  field,
  machine,
  stillAt,
  harnesses = NO_HARNESSES,
}: {
  row: Arranged
  settings: Settings
  /** It sits under its Project's header, which already names the Project. */
  inProject: boolean
  current: boolean
  /** Its Thread stands on a free workspace, away from the one its
   * Project has (ADR 0102, decision 6). */
  away?: boolean
  /** A button that shows while the pointer is over the row: its Later's
   * clock, or Wake (ADR 0074). */
  action?: ReactNode
  /** The field that names it, in its title's place (ADR 0077): the row
   * is then no button. */
  field?: ReactNode
  /** The other machine its Agent works on, after its Project, where no
   * label above names it (ADR 0095, decision 5); this machine never. */
  machine?: Named
  /** When its host went away: its timer and how long ago stand as they
   * were then. */
  stillAt?: number
  /** The Harness list its emblem is read from; none, the Harness's own. */
  harnesses?: readonly EmblemOf[]
}) {
  const onOpen = useOpenRow(row)
  const card = cardOf(row, settings, {
    inProject,
    elsewhere: machine !== undefined,
  })
  const one = card.lines.length === 1
  const slot = (part: Slot, at: number) =>
    part === "title" && field ? (
      <Fragment key={`${part}${at}`}>{field}</Fragment>
    ) : (
      <Piece
        key={`${part}${at}`}
        part={part}
        row={row}
        card={card}
        wide={!one}
        machine={machine}
        stillAt={stillAt}
        harnesses={harnesses}
      />
    )
  const Element = field ? "div" : "button"
  const button = (
    <Element
      type={field ? undefined : "button"}
      aria-current={current ? "true" : undefined}
      className={cn(
        "flex w-full min-w-0 flex-col gap-0.5 rounded-control border border-transparent px-2 text-left transition-colors outline-none",
        "hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50",
        one ? "py-1" : "py-1.5",
        current && "border-border bg-tile shadow-xs hover:bg-tile"
      )}
      onClick={field ? undefined : onOpen}
    >
      {card.lines.map((line, index) => {
        if (line.left.length + line.right.length === 0) return null
        const marked = index === 0 && away
        return (
          <span
            key={index}
            className={cn(
              "flex min-w-0 items-center gap-1.5",
              // With nothing at its right, the title would push the mark
              // under the button that shows over the row: the line keeps
              // that button's room.
              marked && line.right.length === 0 && "pe-7"
            )}
          >
            {line.left.map(slot)}
            {marked && <Away />}
            {line.right.length > 0 && <span className="ml-auto" />}
            {line.right.map(slot)}
          </span>
        )
      })}
    </Element>
  )
  if (!action || field) return button
  return (
    <div data-row className="group/row relative">
      {button}
      <span className="absolute top-1 right-1 hidden items-center rounded-control bg-popover shadow-xs ring-1 ring-foreground/10 group-focus-within/row:flex group-hover/row:flex pointer-coarse:flex">
        {action}
      </span>
    </div>
  )
}

const AWAY = "Away from its Project's workspace"

/** The mark of a Thread away from its Project's workspace (ADR 0102,
 * decision 6): a small diamond, since an arrow is the sign of a Pane in
 * its own window, after the line's left parts, where the row's Later
 * clock never covers it. Only a mark, as the row is a button. */
function Away() {
  return (
    <span title={AWAY} className="shrink-0 text-muted-foreground">
      <DiamondIcon aria-label={AWAY} className="size-3" />
    </span>
  )
}

function Piece({
  part,
  row,
  card,
  wide,
  machine,
  stillAt,
  harnesses,
}: {
  part: Slot
  row: Arranged
  card: Card
  wide: boolean
  machine?: Named
  stillAt?: number
  harnesses: readonly EmblemOf[]
}) {
  const { listed, project } = row
  const { quiet } = card
  switch (part) {
    case "mark":
      // A working card is grey, but its Mark says what its Agent does,
      // already quiet in its own blue (ADR 0107): it does not fade.
      return (
        <ThreadMark
          listed={listed}
          className={cn(quiet && row.stand !== "working" && "opacity-40")}
        />
      )
    case "title":
      return <Title row={row} quiet={quiet} />
    case "project":
      // A row with room shows the Project's sign and name; a row of one
      // line, its sign (ADR 0070, decision 5). Another machine's, then
      // that machine.
      return (
        <>
          {wide ? (
            <ProjectName
              project={project}
              className="text-xs text-muted-foreground"
            />
          ) : (
            <ProjectSign project={project} size={14} />
          )}
          <Machine machine={machine} host={row.host} wide={wide} />
        </>
      )
    case "machine":
      return <Machine machine={machine} host={row.host} wide={wide} />
    case "harness": {
      // Its account's emblem, and in a row of more lines its name (ADR
      // 0093, decision 1).
      const name = listed.by ?? listed.harness
      if (!listed.harness || !name) return null
      return (
        <Emblem
          of={emblemOf(harnesses, listed.harness, name)}
          named={wide}
          nameClassName="max-w-28 text-xs text-muted-foreground"
        />
      )
    }
    case "status":
      return <Status said={card.status} stillAt={stillAt} />
    case "note":
      if (!card.note) return <span className="min-w-0 flex-1" />
      return (
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            TONES[card.note.tone]
          )}
        >
          {card.note.text}
        </span>
      )
  }
}

/** Another machine on a row (ADR 0095, decision 5): its icon and name,
 * small and muted, with no border; its icon alone on a row of one line.
 * Its card, as the pointer rests on it, says the rest, so it has no
 * tooltip. */
function Machine({
  machine,
  host,
  wide,
}: {
  machine?: Named
  host?: string
  wide: boolean
}) {
  if (!machine || host === undefined) return null
  return (
    <MachineCard host={host} className="flex shrink-0">
      <MachineMark named={machine} form={wide ? "compact" : "icon"} title="" />
    </MachineCard>
  )
}

/** The row's title; while a model writes one, it shimmers (ADR 0077,
 * decision 3). */
function Title({ row, quiet }: { row: Arranged; quiet: boolean }) {
  const thinking = useThinking(row.project.id, row.listed.id)
  return (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-sm",
        quiet ? "text-foreground/75" : "text-foreground"
      )}
    >
      <span data-shimmer={thinking || undefined}>
        {thinking ? THINKING : row.listed.title}
      </span>
    </span>
  )
}
