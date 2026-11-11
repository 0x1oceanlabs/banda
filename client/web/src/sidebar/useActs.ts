import { useEngineOf, useRun } from "@banda/core/react"
import type { ItemAction } from "@banda/ui/module"
import type { Act } from "./acts"
import type { Row } from "./arrange"
import type { By } from "./hold"
import { itemActionOf } from "./items"
import { pickLater } from "./LaterPicker"
import { toldArchived, type Undoable, undoOf } from "./undo"
import type { Holding } from "./useHold"

/** What an act on a card is told besides: the card's element, where the
 * Later picker opens; how the Person took it; and, by a key, what to do
 * as it takes the card out of the tab, before the list draws it so. */
export type ActOn = { card: Element; by: By; gone?: () => void }

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
 * by a key on the pick (decision 13): the Thread's App's, by its item
 * actions (ADR 0087, decision 12), which the list draws at once, with
 * what takes each back. Later opens the picker at the card, which then
 * holds the list, and tells `gone` once a time is picked; Archive acts at
 * once, and is told in the toast. The Window that does not reach a card's
 * host has its App refuse at once, and nothing is kept to undo. For a
 * moment after an act by key closed a slot, the buttons take no click.
 */
export function useActs(
  holding: Holding | undefined
): (row: Row, act: Act, on: ActOn) => void {
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
  return (row, act, { card, by, gone }) => {
    if (by === "pointer" && holding?.quiet()) return
    const { listed } = row
    const project = row.project.id
    const undo = (): Undoable | undefined =>
      reaches(row)
        ? { project, listed, steps: undoOf(act, listed, Date.now()) }
        : undefined
    if (act === "later") {
      pickLater({
        project,
        listed,
        anchor: card,
        onPicked: () => {
          gone?.()
          holding?.act(row, by, undo())
        },
      })
      return
    }
    gone?.()
    const done = undo()
    holding?.act(row, by, done)
    if (act === "wake") doing(row, "wake")
    else doing(row, "archive", { archived: act === "archive" })
    if (act === "archive" && done) toldArchived(run, done)
  }
}
