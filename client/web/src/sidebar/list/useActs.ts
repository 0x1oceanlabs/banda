import { useEngineOf, useRun } from "@banda/core/react"
import { toast } from "@banda/ui/components/sonner"
import type { ItemAction } from "@banda/ui/module"
import { type Act, actsOf } from "../model/acts"
import type { Row } from "../model/rows"
import { itemActionOf } from "../../window/items"
import { leftSaid, REFUSED } from "../model/refusals"
import { pickLater } from "./LaterPicker"
import { archivedOf, toldArchived } from "../model/undo"

/** What an act on a card is told besides: the card's element, where the
 * Later picker opens; by a key, what to do as it takes the card out of
 * the tab, before the list draws it so; and, for Later, that it is put
 * off until its turn ends, with no picker. */
export type ActOn = { card: Element; gone?: () => void; done?: true }

/** Runs the item action of a card's Thread that does `what`, its App's,
 * with `more` args: none where its App has none. */
export function useDoing(): (
  row: Row,
  what: NonNullable<ItemAction["does"]>,
  more?: object
) => void {
  const run = useRun()
  return ({ project, listed }, what, more) => {
    const action = itemActionOf(listed, what)
    if (action)
      run(action.id, { project: project.id, item: listed.id, ...more })
  }
}

/**
 * The Person's acts on a card (ADR 0098, decision 10), by its buttons or
 * by a key on the pick (decision 13), Unread by its key alone: the
 * Thread's App's, by its item actions (ADR 0087, decision 12). Later
 * opens the picker at the card, and tells `gone` once a time is picked,
 * or puts it off until its turn ends at once, as the card's menu asks;
 * Archive acts at once, and is told in the toast, whose Undo takes it
 * back. The Window that does not reach a card's host has its App refuse
 * at once, in its toast: the pick stays.
 */
export function useActs(): (row: Row, act: Act | "unread", on: ActOn) => void {
  const run = useRun()
  const doing = useDoing()
  const away = useAway()
  return (row, act, { card, gone, done: untilDone }) => {
    const { listed } = row
    const project = row.project.id
    // The card goes, unless its App refuses.
    const done = () => {
      const reached = away(row) === undefined
      if (reached) gone?.()
      return reached
    }
    if (act === "later" && untilDone) {
      done()
      doing(row, "later", { done: true })
      return
    }
    if (act === "later") {
      pickLater({
        thread: { project, listed },
        anchor: card,
        onPicked: done,
      })
      return
    }
    const reached = done()
    if (act === "wake" || act === "unread") doing(row, act)
    else doing(row, "archive", { archived: act === "archive" })
    // Its Undo puts back the Thread as it stood before.
    if (act === "archive" && reached)
      toldArchived(run, [archivedOf(project, listed, Date.now())])
  }
}

/** Why the Window does not reach `row`'s machine now, in the words its
 * Panes' pill says, as "mac is away"; none while it does. */
function useAway(): (row: Row) => string | undefined {
  const engineOf = useEngineOf()
  return (row) => {
    try {
      engineOf(row.project.id, row.listed.pane)
      return undefined
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Archives every card of `rows` at once, as Your turn's "Archive N done"
 * does (ADR 0098, decision 15): one act, which one Undo takes all back,
 * told in the Archived toast. A card whose machine the Window does not
 * reach stays, and the toast says so, in the words of its Panes' pill.
 */
export function useArchiveAll(): (rows: readonly Row[]) => void {
  const run = useRun()
  const doing = useDoing()
  const away = useAway()
  return (rows) => {
    const acted: Row[] = []
    const left: string[] = []
    for (const row of rows) {
      const why = away(row)
      if (why !== undefined) left.push(why)
      else if (actsOf(row.stand, row.listed).includes("archive"))
        acted.push(row)
    }
    const said = leftSaid(left)
    if (acted.length === 0) {
      if (said) toast(said, { id: REFUSED })
      return
    }
    const now = Date.now()
    const undos = acted.map((row) =>
      archivedOf(row.project.id, row.listed, now)
    )
    for (const row of acted) doing(row, "archive", { archived: true })
    toldArchived(run, undos, said)
  }
}
