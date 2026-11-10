/**
 * A row of the sidebar as one model (ADR 0098, decision 27): from what
 * its App listed, where it stands and the Person's settings, the lines it
 * draws, each a left and a right, and what its status and note say, in
 * which tone. `Row.tsx` and the counts' list only draw it. Pure, so plain
 * tests cover it.
 */
import { MARK_WORDS } from "@banda/ui/components/banda-mark"
import { works } from "@banda/ui/lib/mark-state"
import type { Listed } from "@banda/ui/pane"
import { calls, type Stand } from "@banda/ui/status"
import type { Row } from "./arrange"
import type { Part, Settings } from "./settings"

/**
 * The built-in layouts (ADR 0008, decision 4). The line with the title is
 * always the mark and the title, so a Thread looks the same in every
 * density; the other lines add context. `~` parts a line's left from its
 * right.
 */
const LAYOUTS: Readonly<Record<number, Part[][]>> = {
  1: [["mark", "title", "~", "project", "status"]],
  2: [
    ["mark", "project", "~", "status"],
    ["title", "~", "harness"],
  ],
  3: [["mark", "project", "~", "status"], ["title"], ["note", "~", "harness"]],
}

/** What a slot of a card draws: a part, or another machine's mark where
 * its Project is hidden. */
export type Slot = Exclude<Part, "~"> | "machine"

/** One line of a card: what stands at its left, and at its right. */
export type Line = { left: Slot[]; right: Slot[] }

/** The colour a word is said in: what asks, what failed, done, the
 * text's own, or muted. */
export type Tone = "attention" | "destructive" | "added" | "plain" | "muted"

/** What a card's status says. */
export type Said =
  /** Put off: when it wakes, when its turn ends, or Someday, with no
   * time (ADR 0098, decision 12). */
  | { kind: "later"; until?: number; someday?: true; byAgent: boolean }
  /** It woke by itself at `at`: what calls then, or the time it woke. */
  | { kind: "woke"; at: number; word?: string; tone: Tone }
  /** What its mark says, in its tone. */
  | { kind: "word"; word: string; tone: Tone }
  /** How long the work that runs now has run, from `from`. */
  | { kind: "timer"; from: number }
  /** How long ago it last changed. */
  | { kind: "ago"; at: number }
  /** Nothing: work runs and no one says since when. */
  | { kind: "none" }

/** What a card's note says, and in which tone. */
export type Note = { text: string; tone: Tone }

export type Card = {
  lines: Line[]
  /** Neither the Person's turn nor open: it steps back. */
  quiet: boolean
  status: Said
  note?: Note
}

/** Where the card sits, which its settings do not say. */
export type Placed = {
  /** It sits under its Project's header, which already names it. */
  inProject: boolean
  /** It runs on another machine, which it names after its Project
   * (ADR 0095, decision 5). */
  elsewhere: boolean
}

/** The card of `row`, as `settings` lay it out where it is `placed`. */
export function cardOf(row: Row, settings: Settings, placed: Placed): Card {
  const { listed, stand, woke } = row
  const { lines, hide, layout } = settings.row
  return {
    lines: (layout ?? LAYOUTS[lines] ?? LAYOUTS[3]).map((line) =>
      lineOf(line, hide, placed)
    ),
    // Open is in the text's colour, and work is a grey shelf (ADR 0098,
    // decision 3).
    quiet: stand !== "turn" && stand !== "open",
    status: statusOf(listed, stand, woke),
    note: noteOf(listed),
  }
}

/** One line of a layout, with what is hidden or said above left out. */
function lineOf(line: readonly Part[], hide: readonly Part[], placed: Placed) {
  const slots = (parts: readonly Part[]) =>
    parts.flatMap((part): Slot[] => {
      if (part === "~") return []
      if (part === "project" && placed.inProject) return []
      // A card that hides its Project still says where its Thread runs.
      if (hide.includes(part))
        return part === "project" && placed.elsewhere ? ["machine"] : []
      return [part]
    })
  const split = line.indexOf("~")
  return split < 0
    ? { left: slots(line), right: [] }
    : { left: slots(line.slice(0, split)), right: slots(line.slice(split + 1)) }
}

/** What a Thread's status says where it stands: its Later, its waking, or
 * its mark. One a call woke, early or as its turn ended, says that call,
 * as any call does: only its time coming, or a waking that left nothing
 * to call, reads as woke (ADR 0098, decision 11). */
export function statusOf(
  listed: Listed,
  stand: Stand,
  woke: number | undefined
): Said {
  const { mark, later } = listed
  if (stand === "later")
    return {
      kind: "later",
      until: later?.until,
      ...(later?.someday ? { someday: true } : {}),
      byAgent: !!later?.byAgent,
    }
  const byCall = later?.woke !== undefined && later.woke.by !== "time"
  if (woke !== undefined && !(byCall && calls(mark)))
    return {
      kind: "woke",
      at: woke,
      word: calls(mark) ? MARK_WORDS[mark] : undefined,
      tone: markTone(mark),
    }
  return markSaid(listed)
}

/** What a Thread's mark says: what calls, in its tone, done in the text's
 * own; the running turn's timer; or how long ago it last changed. */
export function markSaid({ mark, changed, began }: Listed): Said {
  if (calls(mark) || mark === "offline")
    return {
      kind: "word",
      word: MARK_WORDS[mark],
      tone: mark === "done" ? "plain" : markTone(mark),
    }
  if (works(mark))
    return began === undefined
      ? { kind: "none" }
      : { kind: "timer", from: began }
  return { kind: "ago", at: changed }
}

/** The tone a mark calls in, as Banda's mark colours it (`toneOf`): a
 * question's, a failure's, done's green, or the text's own. */
function markTone(mark: Listed["mark"]): Tone {
  if (mark === "asking") return "attention"
  if (mark === "failed" || mark === "offline") return "destructive"
  if (mark === "done") return "added"
  return "plain"
}

/** Its note: what calls the Person, in its colour, or what it was last
 * asked, muted. */
function noteOf({ calls: calling, said, mark }: Listed): Note | undefined {
  if (calling)
    return {
      text: calling,
      tone: mark === "asking" ? "attention" : "destructive",
    }
  return said ? { text: said, tone: "muted" } : undefined
}
