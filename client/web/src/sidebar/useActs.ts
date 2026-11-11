import { useEngineOf, useRun } from "@banda/core/react"
import type { ItemAction } from "@banda/ui/module"
import type { Act } from "./acts"
import type { Row } from "./rows"
import type { By } from "./hold"
import { itemActionOf } from "./items"
import { pickLater } from "./LaterPicker"
import { keep, toldArchived, type Undoable, undoOf } from "./undo"
import type { Holding } from "./useHold"

/** What an act on a card is told besides: the card's element, where the
 * Later picker opens; how the Person took it, else as their last input in
 * the list did, as from the card's menu; by a key, what to do as it takes
 * the card out of the tab, before the list draws it so; and, for Later,
 * that it is put off until its turn ends, with no picker. */
export type ActOn = { card: Element; by?: By; gone?: () => void; done?: true }

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
 * Thread's App's, by its item actions (ADR 0087, decision 12), which the
 * list draws at once, with what takes each back. Later opens the picker
 * at the card, which then holds the list, and tells `gone` once a time is
 * picked, or puts it off until its turn ends at once, as the card's menu
 * asks; Archive acts at once, and is told in the toast. Each is kept for
 * `Ctrl+Z` too. The Window that does not reach a card's host has its App
 * refuse at once, in its toast: the pick stays, and nothing is kept to
 * undo. For a moment after an act by key closed a slot, the buttons take
 * no click.
 */
export function useActs(
  holding: Holding | undefined
): (row: Row, act: Act | "unread", on: ActOn) => void {
  const run = useRun()
  const doing = useDoing()
  const engineOf = useEngineOf()
  const reaches = (row: Row) => {
    try {
      engineOf(row.project.id, row.listed.pane)
      return true
    } catch {
      return false
    }
  }
  return (row, act, { card, by, gone, done: untilDone }) => {
    if (by === "pointer" && holding?.quiet()) return
    const { listed } = row
    const project = row.project.id
    // What takes it back, kept, as the card goes; none where it is refused.
    const done = (): Undoable | undefined => {
      if (!reaches(row)) return undefined
      gone?.()
      const undo = { project, listed, steps: undoOf(act, listed, Date.now()) }
      keep(undo)
      return undo
    }
    if (act === "later" && untilDone) {
      holding?.act(row, by, done())
      doing(row, "later", { done: true })
      return
    }
    if (act === "later") {
      pickLater({
        project,
        listed,
        anchor: card,
        onPicked: () => holding?.act(row, by, done()),
      })
      return
    }
    const undo = done()
    holding?.act(row, by, undo)
    if (act === "wake" || act === "unread") doing(row, act)
    else doing(row, "archive", { archived: act === "archive" })
    if (act === "archive" && undo) toldArchived(run, undo)
  }
}
