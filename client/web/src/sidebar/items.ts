/**
 * What the Person can do to one Item, by its item actions (ADR 0087,
 * decision 12): its App's, found by the first word of its Pane kind, in
 * their order, then the sidebar list's own, Archive. The Thread menu, the
 * Pane menu, the Banda menu's Tab, the title's field and the Later's
 * picker draw their rows, and run them as any action, by id: none of them
 * knows what an App does to its Items. And why the sidebar's `S` leaves a
 * card that asks or works, in its toast.
 */
import type { ProjectId, ProjectSummary } from "@banda/contract"
import {
  type ItemAction,
  type ItemAt,
  type ItemRow,
  itemArgs,
  itemOf,
} from "@banda/ui/module"
import type { Listed } from "@banda/ui/pane"
import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react"
import { itemsOf, kinds } from "../registry"
import type { StandRow } from "../tiling/PaneMenu"
import type { Shell } from "../window/actions"
import { toast } from "@banda/ui/components/sonner"
import { mayArchive, type Stand } from "@banda/ui/status"
import { toggled } from "./archived"

/**
 * Archive thread, or Unarchive thread (ADR 0069; ADR 0008, decision 4):
 * the sidebar list's own row and key. The Item's host keeps the mark (ADR
 * 0096), so its App's own archive sends it there, in one command, which
 * ends a put-off Thread's Later too; archived, the Item is put away at
 * once, without waiting for its host's answer: every Pane that shows it
 * closes, on any workspace (#974). An Item whose App has none stays as it
 * is.
 */
export const archiving: ItemAction<Shell> = {
  id: "sidebar.archive",
  section: "Threads",
  title: "Archive the Thread you look at, or bring it back",
  keys: [{ code: "KeyS", mod: true }],
  args: itemArgs(),
  group: "other",
  does: "archive",
  offered: ["menu"],
  row: (item) =>
    item.archived
      ? { title: "Unarchive thread", icon: ArchiveRestoreIcon }
      : {
          title: "Archive thread",
          icon: ArchiveIcon,
          // Not while it works or asks.
          ...(mayArchive(item) ? {} : { off: true }),
        },
  run: (shell, args) => {
    const at = itemOf(shell, args)
    if (!at) return
    const { project, listed } = at
    const archived = toggled(shell.items.get(), project, listed.id)
    if (archived === undefined) return
    const owner = itemActionOf(listed, "archive")
    if (owner && owner !== archiving)
      shell.run(owner.id, { project, item: listed.id, archived })
  },
}

/** The item actions of `listed`: its App's, in their order, then the
 * sidebar list's. */
export function itemActionsOf(listed: Listed): readonly ItemAction<Shell>[] {
  return [...itemsOf(listed.pane.kind), archiving]
}

/** The item action of `listed` that does `does`, as the title's field
 * renames by its App's; none where its App has none. */
export function itemActionOf(
  listed: Listed,
  does: NonNullable<ItemAction["does"]>
): ItemAction<Shell> | undefined {
  return doing(itemActionsOf(listed), does)
}

/** Of `actions`, the first that does `does`. */
const doing = (
  actions: readonly ItemAction<Shell>[],
  does: NonNullable<ItemAction["does"]>
) => actions.find((action) => action.does === does)

/** The item action that does `does` of the first App with one: what
 * words name the key of where no Item is in view, as an empty Later's
 * do. */
export function actionDoing(
  does: NonNullable<ItemAction["does"]>
): ItemAction<Shell> | undefined {
  return doing(
    kinds.flatMap(({ kind }) => itemsOf(kind)),
    does
  )
}

/** An item action with its row for one Item. */
export type Shown = { action: ItemAction<Shell>; row: ItemRow }

/** The rows of `listed` that apply `at`, in their order. */
export function rowsOf(listed: Listed, at: ItemAt): Shown[] {
  return itemActionsOf(listed).flatMap((action) => {
    const row = action.row(listed, at)
    return row ? [{ action, row }] : []
  })
}

/** The rows of `listed` offered `where`, the Pane menu or the Banda
 * menu's Tab: those on, as a row that is off is left out there. */
function offeredOf(
  listed: Listed,
  at: ItemAt,
  where: "pane" | "menu"
): Shown[] {
  return rowsOf(listed, at).filter(
    ({ action, row }) => action.offered?.includes(where) && !row.off
  )
}

/** The Pane menu's rows for `listed`, the Item a Pane of `project` shows:
 * those its item actions offer there now, each with what runs it. */
export function paneRowsOf(
  listed: Listed,
  project: ProjectId,
  projects: readonly ProjectSummary[]
): StandRow[] {
  const at: ItemAt = {
    project: projects.find((one) => one.id === project),
    now: Date.now(),
  }
  return offeredOf(listed, at, "pane").map(({ action, row }) => ({
    id: action.id,
    title: row.title,
    icon: row.icon,
    args: { project, item: listed.id },
  }))
}

/** The toast a refusal shows in: one at a time. */
export const REFUSED = "sidebar-refused"

/**
 * Why the sidebar's `S` leaves a card where it is (spec §2.6, "Refusals"):
 * one that asks is answered first, and one at work waits for its turn's
 * end; `later` names the key in force that puts it off. The toast's title
 * says what stops it, and its next line, which wraps, what to do. None for
 * any other card.
 */
export function refusalOf(
  { stand, listed }: { stand: Stand; listed: Pick<Listed, "title" | "mark"> },
  later: string | undefined
): { title: string; description: string } | undefined {
  const title = `“${listed.title}”`
  if (stand === "working")
    return {
      title: `${title} is at work.`,
      description: later
        ? `${later} puts it off until it's done.`
        : "Put it off until it's done.",
    }
  if (listed.mark === "asking")
    return {
      title: `${title} asks you.`,
      description: later
        ? `Answer it, or ${later} puts it off.`
        : "Answer it, or put it off.",
    }
  return undefined
}

/** Says why `S` leaves the card, by `refusalOf`, in a toast, never a
 * shake. */
export function refused(
  card: Parameters<typeof refusalOf>[0],
  later: string | undefined
): void {
  const why = refusalOf(card, later)
  if (why) toast(why.title, { id: REFUSED, description: why.description })
}

/** What a card of a set says to an act that leaves it: it asks, it is at
 * work, or its machine is not reached, and why, in the words its Panes'
 * pill says, as "mac is away". */
export type Left = "asks" | "works" | { away: string }

/** How many `n` of a word, its verb by number: "1 asks", "2 ask". */
const counted = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/**
 * What an act on several cards at once left, still selected (spec §2.6):
 * "1 asks you, 2 are at work, 2 not reached (mac is away), still
 * selected"; none where it left none.
 */
export function leftSaid(left: readonly Left[]): string | undefined {
  if (left.length === 0) return undefined
  const asks = left.filter((one) => one === "asks").length
  const works = left.filter((one) => one === "works").length
  const away = new Map<string, number>()
  for (const one of left)
    if (typeof one === "object")
      away.set(one.away, (away.get(one.away) ?? 0) + 1)
  return [
    asks > 0 && `${counted(asks, "asks", "ask")} you`,
    works > 0 && `${counted(works, "is", "are")} at work`,
    ...[...away].map(([why, n]) => `${n} not reached (${why})`),
    "still selected",
  ]
    .filter(Boolean)
    .join(", ")
}

/**
 * Why Archive leaves every card of a set where it is (spec S10b): they
 * ask, or they are at work; `later` names the key in force that puts them
 * off. One card says it as `S` does on it alone.
 */
export function setRefusalOf(
  cards: readonly { stand: Stand; listed: Pick<Listed, "title" | "mark"> }[],
  later: string | undefined
): string | undefined {
  const [one] = cards
  if (!one) return undefined
  if (cards.length === 1) {
    const why = refusalOf(one, later)
    return why && `${why.title} ${why.description}`
  }
  const working = cards.filter((card) => card.stand === "working").length
  if (working === cards.length)
    return `They are at work. ${
      later ? `${later} puts them off` : "Put them off"
    } until they're done.`
  const off = later ? `${later} puts them off.` : "Put them off."
  return working > 0
    ? `They ask you or are at work. ${off}`
    : `They ask you. ${off}`
}
