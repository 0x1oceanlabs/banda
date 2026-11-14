import { ThreadMark } from "@banda/ui/components/banda-mark"
import { Emblem, emblemOf, type EmblemOf } from "@banda/ui/components/emblem"
import { MachineMark } from "@banda/ui/components/machine-icon"
import type { ProjectSummary } from "@banda/contract"
import { useMinute } from "@banda/ui/hooks/use-now"
import { THINKING, useThinking } from "@banda/ui/lib/naming"
import { short } from "@banda/ui/lib/words"
import {
  type Does,
  type Held,
  heldDoing,
  HOLD,
  sameDoes,
} from "@banda/ui/status"
import {
  ArchiveRestoreIcon,
  CheckIcon,
  ClockIcon,
  type LucideIcon,
  Undo2Icon,
} from "lucide-react"
import {
  createContext,
  Fragment,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react"
import type { Act } from "../model/acts"
import { awayShort } from "../../machines/words"
import { MachineCard } from "../list/MachineCard"
import { keyOf, type Row } from "../model/rows"
import { Card, type CardLine, type ShownAct } from "./Card"
import {
  type CardModel,
  saysWords,
  type Slot,
  spokenOf,
  timeShown,
  workSaid,
} from "./model"
import {
  CardTitle,
  Diff,
  MarkCell,
  Meta,
  Parent,
  ProjectName,
  PullChip,
  Says,
  Strayed,
  Works,
} from "./parts"
import { CardTime } from "./Time"

const NO_HARNESSES: readonly EmblemOf[] = []
const NO_ACTS: readonly CardAct[] = []

/** What a card offers under the pointer (`acts.ts`): the act; the key
 * in force that does it, and a note, both said in its tooltip; and what
 * it does from the card it was pressed on. `run` stays a function, as it
 * was: it takes that card, which the Later's picker stands by, and runs
 * the act by its id (`useActs`). */
export type CardAct = {
  act: Act
  key?: string
  note?: string
  run: (card: Element) => void
}

/** The Project's menu its sign on a card's line 3 has (ADR 0098, decision
 * 14), this machine's alone; none outside the sidebar's list, which hands
 * it. */
export const SignMenu = createContext<
  ((project: ProjectSummary, sign: ReactElement) => ReactElement) | undefined
>(undefined)

/** Each act's icon and name (ADR 0098, decision 10), on the card and in
 * its menu. */
export const ACT_LOOK: Readonly<
  Record<Act, { icon: LucideIcon; name: string }>
> = {
  later: { icon: ClockIcon, name: "Later" },
  archive: { icon: CheckIcon, name: "Archive" },
  wake: { icon: Undo2Icon, name: "Wake" },
  unarchive: { icon: ArchiveRestoreIcon, name: "Unarchive" },
}

/** `act` as its card shows it: its look, and its key and note in its
 * tooltip. */
const shownAct = ({ act, key, note, run }: CardAct): ShownAct => {
  const { icon, name } = ACT_LOOK[act]
  const named = key ? `${name} (${key})` : name
  return {
    id: act,
    icon,
    name,
    title: note ? `${named} · ${note}` : named,
    run,
  }
}

/**
 * A Thread's card (ADR 0098, decisions 8 and 9), from its model
 * (`model.ts`), drawn by the one `Card`. A child under its parent starts
 * with ↳, and its lines go in by as much (decision 24). Colour is only on
 * a call's mark and time. Its times are drawn again as each minute
 * begins, on one timer for every card (`useMinute`), and, at work, as
 * what its Agent does shows (`useHeld`). A click opens the Pane it stands
 * for, by `pane.pick`; a screen reader hears it by `spokenOf`. Its acts
 * show under the pointer (decision 10).
 */
export function ThreadCard({
  card: model,
  row,
  current,
  picked = false,
  acts = NO_ACTS,
  field,
  harnesses = NO_HARNESSES,
}: {
  card: CardModel
  /** The row it is drawn from: what it opens, and whose title a model
   * may be writing. */
  row: Row
  /** Its Thread is the open one. */
  current: boolean
  /** The list's keys act on it. */
  picked?: boolean
  /** What it offers under the pointer, Later first. */
  acts?: readonly CardAct[]
  /** The field that names it, in its title's place (ADR 0077): a click
   * on the card then opens nothing. */
  field?: ReactNode
  /** The Harness list its emblem is read from; none, the Harness's own. */
  harnesses?: readonly EmblemOf[]
}) {
  const card = useHeld(model)
  const now = useMinute()
  const spoken = spokenOf(card, now)
  const three = card.lines.length === 3
  const slot = (part: Slot, at: number) => (
    <Fragment key={`${part.kind}${at}`}>
      {part.kind === "title" && field ? (
        field
      ) : (
        <Piece
          slot={part}
          card={card}
          row={row}
          current={current}
          now={now}
          harnesses={harnesses}
        />
      )}
    </Fragment>
  )
  const lines = card.lines.map((line, index): CardLine => {
    // #1160's mark: at the start of line 3's right; with fewer lines,
    // right after the title; never at line 1's right, where the acts show.
    const strayed = card.strayed && index === (three ? 2 : 0)
    return {
      left: (
        <>
          {line.left.map(slot)}
          {strayed && !three && <Strayed />}
        </>
      ),
      right: ((strayed && three) || line.right.length > 0) && (
        <>
          {strayed && three && <Strayed />}
          {line.right.map(slot)}
        </>
      ),
    }
  })
  return (
    <Card
      card={{
        stop: keyOf(row.host, row.listed.id),
        picked,
        lines,
        row: true,
        // One being named has none, and opens nothing.
        acts: field ? [] : acts.map(shownAct),
        ...(field
          ? {}
          : {
              name: spoken.name,
              description: spoken.description || undefined,
              // Opens the Pane it stands for, where a workspace shows
              // it, or in a new column of the current one (`pane.pick`).
              press: {
                action: "pane.pick",
                args: { project: row.project.id, pane: row.listed.pane },
              },
            }),
        tone: card.tone,
        current,
        away: card.away !== undefined,
        under: card.child?.under === true,
      }}
    />
  )
}

/**
 * `card` as it shows what its Agent does at work (ADR 0099, decision 2):
 * held as a Mark holds what it shows, each doing at least `HOLD`
 * (`heldDoing`), so its words do not flicker and its words, its time and
 * its Mark never disagree. A first shows at once; a next one, once the one
 * shown has held. Nothing holds, and nothing waits, while it does not
 * work.
 */
function useHeld(card: CardModel): CardModel {
  const { does } = card
  const [held, setHeld] = useState<Held<Does> | undefined>(
    () => does && { doing: does, since: Date.now() }
  )
  if (!does && held) setHeld(undefined)
  const waits = does && !(held && sameDoes(held.doing, does))
  useEffect(() => {
    if (!waits || !does) return
    const timer = setTimeout(
      () => setHeld((was) => heldDoing(was, does, Date.now(), sameDoes)),
      held ? held.since + HOLD - Date.now() : 0
    )
    return () => clearTimeout(timer)
  }, [waits, does, held])
  return waits && held ? { ...card, does: held.doing } : card
}

/** What a slot of a Thread's card draws, by the parts every card has. */
function Piece({
  slot,
  card,
  row,
  current,
  now,
  harnesses,
}: {
  slot: Slot
  card: CardModel
  row: Row
  current: boolean
  now: number
  harnesses: readonly EmblemOf[]
}) {
  const withMenu = useContext(SignMenu)
  // Its words stand as of when its machine was last heard, while away.
  const at = card.away?.since ?? now
  switch (slot.kind) {
    case "mark":
      // Its look's colour, or its weight for what calls no one (ADR 0099,
      // decisions 1 and 10; ADR 0107 for a working one's muted blue); at
      // work, what its card holds its Agent does; open, no call (decision
      // 5).
      return (
        <MarkCell>
          <ThreadMark
            listed={row.listed}
            look={slot.look}
            doing={card.does?.doing}
            held
            current={current}
          />
        </MarkCell>
      )
    case "title":
      return <Title row={row} card={card} />
    case "time":
      return <CardTime time={timeShown(card)} now={at} quiet={card.quiet} />
    case "says":
      return (
        <Says
          word={slot.word}
          text={saysWords(slot, (when) => short(when, at))}
          quiet={card.quiet !== undefined}
        />
      )
    case "works":
      return <Works words={workSaid(card, at)} />
    case "diff":
      return <Diff added={slot.added} removed={slot.removed} />
    case "pull":
      return <PullChip pull={slot} />
    case "project": {
      const sign = <ProjectName project={slot.project} />
      // This machine's has the Project's menu (ADR 0098, decision 14); a
      // Thread's own No Project has none.
      return withMenu && row.host === undefined && !slot.project.scratch
        ? withMenu(slot.project, sign)
        : sign
    }
    case "parent":
      return <Parent title={slot.title} />
    case "machine": {
      // A machine (ADR 0095, decision 5): its icon and name, small and
      // muted, with no border; its icon alone where room is short or the
      // Person asked. Another machine's card, as the pointer rests on it,
      // says the rest; this machine has none, its name its icon's tooltip.
      const form = slot.named ? "compact" : "icon"
      if (slot.host === undefined)
        return <MachineMark named={slot.machine} form={form} />
      return (
        <MachineCard host={slot.host} className="flex shrink-0">
          <MachineMark named={slot.machine} form={form} title="" />
        </MachineCard>
      )
    }
    case "harness":
      // Its account's emblem (ADR 0093, decision 1).
      return <Emblem of={emblemOf(harnesses, slot.id, slot.name)} />
    case "away": {
      // Since when its machine is out of reach, by the list's clock, after
      // the machine's name: "arc · away 12m" (decision 18).
      const words = card.away && awayShort(card.away, now)
      return words && <Meta>{slot.dot ? `· ${words}` : words}</Meta>
    }
  }
}

/** The card's title, at 500 in Your turn, grey at work and dimmer put
 * away; while a model writes one, it shimmers (ADR 0077, decision 3). */
function Title({ row, card }: { row: Row; card: CardModel }) {
  const thinking = useThinking(row.project.id, row.listed.id)
  return (
    <CardTitle
      title={thinking ? THINKING : card.title}
      tip={thinking ? undefined : card.title}
      strong={card.place === "turn"}
      quiet={card.quiet}
      shimmer={thinking}
    />
  )
}
