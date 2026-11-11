import { ThreadMark } from "@banda/ui/components/banda-mark"
import { Emblem, emblemOf, type EmblemOf } from "@banda/ui/components/emblem"
import { FadeText } from "@banda/ui/components/fade-text"
import { MachineMark } from "@banda/ui/components/machine-icon"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { THINKING, useThinking } from "@banda/ui/lib/naming"
import { projectLabel } from "@banda/ui/lib/projects"
import { cn } from "@banda/ui/lib/utils"
import { short } from "@banda/ui/lib/words"
import { DiamondIcon } from "lucide-react"
import { Fragment, type ReactNode } from "react"
import {
  type CardModel,
  type CardRow,
  saysWords,
  type Slot,
  spokenOf,
  STRAYED,
  timesOf,
} from "./card"
import { CardTime } from "./CardStatus"
import { dueOf, useClock } from "./clock"
import { MachineCard } from "./MachineCard"
import { useOpenRow } from "./open"

const NO_HARNESSES: readonly EmblemOf[] = []

/**
 * A sidebar card (ADR 0098, decisions 8 and 9), drawn from its model
 * (`card.ts`): one to three lines, each a left and a right, lines 2 and 3
 * under the title, past the mark. Colour is only on a call's mark and
 * time. It is drawn again only as one of its times changes (`clock.ts`).
 * A click opens the Pane it stands for, by `pane.pick`; a screen reader
 * hears it by `spokenOf`.
 */
export function Card({
  card,
  row,
  current,
  action,
  field,
  harnesses = NO_HARNESSES,
}: {
  card: CardModel
  /** The row it is drawn from: what it opens, and whose title a model
   * may be writing. */
  row: CardRow
  /** Its Thread is the open one. */
  current: boolean
  /** A button that shows while the pointer is over the card: its Later's
   * clock, or Wake (ADR 0074). */
  action?: ReactNode
  /** The field that names it, in its title's place (ADR 0077): the card
   * is then no button. */
  field?: ReactNode
  /** The Harness list its emblem is read from; none, the Harness's own. */
  harnesses?: readonly EmblemOf[]
}) {
  const onOpen = useOpenRow(row)
  const now = useCardClock(card)
  const spoken = spokenOf(card, now)
  const one = card.lines.length === 1
  // One that left, or one being named, has none.
  const acts = action !== undefined && !card.gone && !field
  const Element = field ? "div" : "button"
  const drawn = (
    <Element
      type={field ? undefined : "button"}
      aria-current={current ? "true" : undefined}
      aria-label={field ? undefined : spoken.name}
      aria-description={field ? undefined : spoken.description || undefined}
      data-tone={card.tone}
      className={cn(
        "relative isolate flex w-full min-w-0 flex-col gap-0.5 rounded-control px-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        // The hover's fill is a layer under the card that fades: at once
        // in, over 100 ms out, by its opacity alone (ADR 0088, decision
        // 2); it stays while the pointer is on the card's action.
        "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-foreground/5 before:opacity-0 before:transition-opacity before:duration-100 before:ease-(--ease-exit) group-hover/row:before:opacity-100 group-hover/row:before:duration-0 hover:before:opacity-100 hover:before:duration-0",
        one ? "py-1" : "py-1.5",
        // The open Thread's card: a fill, with no shadow and no border.
        current && "bg-foreground/8 before:hidden"
      )}
      onClick={field ? undefined : onOpen}
    >
      <CardLines
        card={card}
        row={row}
        now={now}
        acts={acts}
        field={field}
        harnesses={harnesses}
      />
    </Element>
  )
  if (field || (!action && !card.gone)) return drawn
  return (
    <div data-row className="group/row relative">
      {drawn}
      {acts && (
        <span
          className={cn(
            "absolute right-1 hidden items-center rounded-control bg-popover shadow-xs ring-1 ring-foreground/10 group-focus-within/row:flex group-hover/row:flex pointer-coarse:flex",
            // Level with line 1, at the card's own top padding.
            one ? "top-1" : "top-1.5"
          )}
        >
          {action}
        </span>
      )}
    </div>
  )
}

/** The moment `card` is drawn as of: the list's clock (`clock.ts`), which
 * draws it again only as one of its times changes. */
export function useCardClock(card: CardModel): number {
  return useClock((at) => dueOf(timesOf(card), at))
}

/**
 * A card's lines (ADR 0098, decision 8), as the sidebar's card and the
 * counts' list draw them: each a left and a right, lines 2 and 3 under the
 * title, past the mark. Text that does not fit fades out at its end, and
 * shows whole as the pointer rests on it (`FadeText`'s tooltip, where a
 * `CutTips` holds it).
 */
export function CardLines({
  card,
  row,
  now,
  acts = false,
  field,
  harnesses = NO_HARNESSES,
}: {
  card: CardModel
  row: CardRow
  /** The moment it is drawn as of (`useCardClock`). */
  now: number
  /** Its action shows over line 1's right while the pointer is on it. */
  acts?: boolean
  /** The field that names it, in its title's place. */
  field?: ReactNode
  harnesses?: readonly EmblemOf[]
}) {
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
          now={now}
          harnesses={harnesses}
        />
      )}
    </Fragment>
  )
  return card.lines.map((line, index) => {
    const first = index === 0
    // #1160's mark: at the start of line 3's right, else right after the
    // title, never at line 1's right, under the card's action.
    const strayed = card.strayed && index === (three ? 2 : 0)
    // Where a card that left went takes line 1's right.
    const right =
      first && card.gone
        ? card.gone.words && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {card.gone.words}
            </span>
          )
        : (strayed || line.right.length > 0) && (
            <>
              {strayed && three && <Strayed />}
              {line.right.map(slot)}
            </>
          )
    return (
      <span
        key={index}
        className={cn(
          "flex min-w-0 items-center gap-1.5",
          first ? "min-h-5" : "min-h-4 pl-5.5"
        )}
      >
        {line.left.map(slot)}
        {strayed && !three && <Strayed />}
        {right && (
          <span
            className={cn(
              "ml-auto flex shrink-0 items-center justify-end gap-1.5",
              // While the action shows, it stands in the right's place,
              // which hides under it whole.
              first &&
                acts &&
                "group-focus-within/row:invisible group-hover/row:invisible pointer-coarse:invisible",
              // The right keeps the room of that action, Wake's or the
              // Later clock's, so the mark after the title stays in sight
              // even by a time as short as "2h".
              first &&
                strayed &&
                (card.stand === "later" ? "min-w-15" : "min-w-5")
            )}
          >
            {right}
          </span>
        )}
      </span>
    )
  })
}

/** The mark of a Thread away from its Project's workspace (ADR 0102,
 * decision 6): a small diamond, as an arrow is the sign of a Pane in its
 * own window, where the card's action never covers it. A screen reader
 * hears it in the card's description. */
function Strayed() {
  return (
    <span title={STRAYED} className="shrink-0 text-muted-foreground">
      <DiamondIcon aria-hidden className="size-3" />
    </span>
  )
}

function Piece({
  slot,
  card,
  row,
  now,
  harnesses,
}: {
  slot: Slot
  card: CardModel
  row: CardRow
  now: number
  harnesses: readonly EmblemOf[]
}) {
  switch (slot.kind) {
    case "mark":
      // Its look's colour, or its weight for what calls no one (ADR 0099,
      // decisions 1 and 10; ADR 0107 for a working one's muted blue).
      return <ThreadMark listed={row.listed} look={slot.look} />
    case "title":
      return <Title row={row} card={card} />
    case "time":
      return (
        <CardTime
          time={card.time}
          now={card.away?.since ?? now}
          quiet={card.quiet}
        />
      )
    case "says": {
      const rest = saysWords(slot, (at) => short(at, card.away?.since ?? now))
      // What it says is never in a colour: a done note is never red.
      return (
        <FadeText
          tip={[slot.word, rest].filter(Boolean).join(" ")}
          className="flex-1 text-xs text-muted-foreground"
        >
          {slot.word && (
            <span
              className={cn(
                "font-medium",
                card.quiet ? "text-foreground/55" : "text-foreground/85"
              )}
            >
              {slot.word}
            </span>
          )}
          {slot.word && rest && " "}
          {rest}
        </FadeText>
      )
    }
    case "project": {
      const name = projectLabel(slot.project)
      return (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
          <ProjectSign project={slot.project} size={14} />
          <FadeText tip={name}>{name}</FadeText>
        </span>
      )
    }
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
  }
}

/** The card's title, at 500 in Your turn, grey at work and dimmer put
 * away; while a model writes one, it shimmers (ADR 0077, decision 3). */
function Title({ row, card }: { row: CardRow; card: CardModel }) {
  const thinking = useThinking(row.project.id, row.listed.id)
  return (
    <FadeText
      tip={thinking ? undefined : card.title}
      className={cn(
        "text-sm",
        card.place === "turn" && "font-medium",
        card.quiet === "working"
          ? "text-foreground/45"
          : card.quiet
            ? "text-foreground/55"
            : "text-foreground"
      )}
    >
      <span data-shimmer={thinking || undefined}>
        {thinking ? THINKING : card.title}
      </span>
    </FadeText>
  )
}
