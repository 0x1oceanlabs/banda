/**
 * The sidebar's one card (ADR 0098, decisions 8, 9 and 27): a Thread's
 * and a Project's that waits for the Person are drawn by it, each from
 * the model its kind makes of it (`ThreadCard.tsx`, `ProjectCard.tsx`).
 * It reads no store and no clock, and decides nothing: it draws what it
 * is given, from the theme's tokens and `@banda/ui`'s classes, and runs a
 * press as the action its model names, by its id, as the list's keys
 * would.
 */
import type { Args } from "@banda/core"
import { Button } from "@banda/ui/components/button"
import { cn } from "@banda/ui/lib/utils"
import type { LucideIcon } from "lucide-react"
import type { CSSProperties, ReactNode } from "react"
import { actsWidth } from "../acts"
import { useOpen } from "../open"
import { pickProps } from "../usePick"
import { ChildArrow } from "./parts"

/** The hover's fill, a layer under a card or a group's header that fades
 * (globals.css): at once in, over 100 ms out, by its opacity alone (ADR
 * 0088, decision 2). */
export const HOVER_FILL =
  "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-foreground/5 before:opacity-0 before:transition-opacity before:duration-100 before:ease-(--ease-exit)"

/** One line of a card, drawn: what stands at its left, and at its right;
 * none at its right leaves it out. */
export type CardLine = { left: ReactNode; right?: ReactNode }

/** What a press on a card runs: an action by its id, with its args, as
 * a key would run it. */
export type Press = { action: string; args?: Args }

/** An act a card shows under the pointer, at line 1's right: its icon,
 * its name, its tooltip, and what it does from the card it was pressed
 * on. Its `run` takes that card, the element the Later's picker stands
 * by, so it stays a function: each runs its act by id
 * (`useActs`, as the old `CardView` did). */
export type ShownAct = {
  id: string
  icon: LucideIcon
  name: string
  title: string
  run: (card: Element) => void
}

/** What a card draws. */
export type Drawn = {
  /** Its key as a stop of the pick, which the list's keys move. */
  stop: string
  /** The list's keys act on it. */
  picked: boolean
  /** Its three, two or one lines; line 2 and 3 under the title, past the
   * mark. */
  lines: readonly CardLine[]
  /** What a screen reader hears: its name, and what describes it. */
  name?: string
  description?: string
  /** The colour of its call, which its mark and time draw. */
  tone?: string
  /** It stands for the open Pane: a fill, with no shadow and no border. */
  current?: boolean
  /** Its machine is out of reach: it dims where it stands. */
  away?: boolean
  /** A child under its parent: ↳ first, its lines in by as much. */
  under?: boolean
  /** It is a row of the list, as the list's glance and counts find it. */
  row?: boolean
  /** What it shows under the pointer over line 1's right, Later first. */
  acts?: readonly ShownAct[]
  /** Buttons that show always, under its lines. */
  buttons?: ReactNode
  /** Its own attributes, which the list and the Window find it by. */
  data?: Readonly<Record<`data-${string}`, string>>
  /** The action a press on it runs, by its id; none, a press does
   * nothing. */
  press?: Press
}

const NO_ACTS: readonly ShownAct[] = []

/**
 * A sidebar card (ADR 0098, decisions 8 and 9): three, two or one lines,
 * each a left and a right, lines 2 and 3 under the title, past the mark.
 * It is an option of the list, which keys pick (decision 13): it has no
 * focus of its own, and its ring shows while the list has the focus and
 * the last input was a key (`globals.css`). Under the pointer, or always
 * on a coarse pointer, its acts show at line 1's right, in the time's
 * place (decision 10): no Tab stops, as keys and menu rows do the same.
 */
export function Card({ card }: { card: Drawn }) {
  const { lines, acts = NO_ACTS, row = false, press } = card
  // A press opens what the card stands for: the Sidebar over the Strip
  // lets itself go first (`useOpen`).
  const open = useOpen()
  const one = lines.length === 1
  // A card with no acts around it is its row itself, as the list's glance
  // finds it (`glanceAt`).
  const bare = acts.length === 0
  const drawn = (
    <div
      data-row={row && bare ? "" : undefined}
      {...pickProps(card.stop, card.picked)}
      aria-current={card.current ? "true" : undefined}
      aria-label={card.name}
      aria-description={card.description}
      data-tone={card.tone}
      {...card.data}
      data-card=""
      data-away={card.away ? "" : undefined}
      className={cn(
        "relative isolate flex w-full min-w-0 flex-col gap-0.5 rounded-control px-2 text-left",
        // Its machine out of reach, it dims where it stands, over
        // --dur-slow, and comes back alike (decision 18; spec §2.1).
        "transition-opacity duration-(--dur-slow) ease-(--ease)",
        card.away && "opacity-55",
        // It stays while the pointer is on an act.
        HOVER_FILL,
        one ? "py-1" : "py-1.5",
        // The open Thread's card: a fill, with no shadow and no border.
        card.current && "bg-foreground/8 before:hidden"
      )}
      onClick={press && (() => open(press.action, press.args))}
    >
      {lines.map((line, index) => (
        <Line
          key={index}
          line={line}
          first={index === 0}
          under={card.under}
          acts={acts.length}
        />
      ))}
      {card.buttons && (
        // Hidden from a screen reader, which hears the card and has its
        // keys; a click takes no focus.
        <span aria-hidden className="flex items-center gap-1.5 pt-1 pl-5.5">
          {card.buttons}
        </span>
      )}
    </div>
  )
  if (bare) return drawn
  return (
    <div data-row={row || undefined} className="relative">
      {drawn}
      {/* Over line 1's right, whose cell keeps their room: an option holds
          no buttons. Hidden from the keys and a screen reader, which have
          the pick's keys and the menu's rows; a click takes no focus. */}
      <span
        aria-hidden
        data-acts=""
        className={cn(
          "absolute right-2 flex items-center gap-0.5",
          one ? "top-1" : "top-1.5"
        )}
      >
        {acts.map(({ id, icon: Icon, name, title, run }) => (
          <Button
            key={id}
            variant="ghost"
            size="icon-xs"
            aria-label={name}
            title={title}
            data-act={id}
            tabIndex={-1}
            className="size-5 text-muted-foreground"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) =>
              run(
                event.currentTarget.closest("[data-row]") ?? event.currentTarget
              )
            }
          >
            <Icon className="size-3.5" />
          </Button>
        ))}
      </span>
    </div>
  )
}

/**
 * A card's line (decision 8): a left and a right. The acts and line 1's
 * right share one cell, which keeps the acts' room while they show: the
 * time hides there, and the title's fade ends before them (`globals.css`).
 */
function Line({
  line,
  first,
  under = false,
  acts,
}: {
  line: CardLine
  first: boolean
  under?: boolean
  /** How many acts show over line 1's right, under the pointer. */
  acts: number
}) {
  const room = first && acts > 0
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        first ? "min-h-5" : under ? "min-h-4 pl-9.5" : "min-h-4 pl-5.5"
      )}
    >
      {first && under && <ChildArrow className="w-2.5" />}
      {line.left}
      {room ? (
        <span className="ml-auto grid shrink-0 items-center justify-items-end">
          <span
            data-acts-time=""
            className="flex items-center gap-1.5 [grid-area:1/1]"
          >
            {line.right}
          </span>
          <span
            data-acts-room=""
            style={{ "--room": `${actsWidth(acts)}px` } as CSSProperties}
            className="[grid-area:1/1]"
          />
        </span>
      ) : (
        line.right && (
          <span className="ml-auto flex shrink-0 items-center justify-end gap-1.5">
            {line.right}
          </span>
        )
      )}
    </span>
  )
}
