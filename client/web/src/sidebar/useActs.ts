import { useEngineOf, useRun } from "@banda/core/react"
import { toast } from "@banda/ui/components/sonner"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import type { ItemAction } from "@banda/ui/module"
import { type Act, actsOf } from "./acts"
import { itemKey, type Row } from "./rows"
import { itemActionOf } from "../window/items"
import {
  type Left,
  leftSaid,
  REFUSED,
  refusalOf,
  refused,
  setRefusalOf,
} from "./refusals"
import { keyId } from "./keys"
import { pickLater } from "./LaterPicker"
import { keep, toldArchived, type Undoable, undoOf } from "./undo"

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
 * Archive acts at once, and is told in the toast. Each is kept for
 * `Ctrl+Z`. The Window that does not reach a card's host has its App
 * refuse at once, in its toast: the pick stays, and nothing is kept to
 * undo.
 */
export function useActs(): (row: Row, act: Act | "unread", on: ActOn) => void {
  const run = useRun()
  const doing = useDoing()
  const away = useAway()
  return (row, act, { card, gone, done: untilDone }) => {
    const { listed } = row
    const project = row.project.id
    // What takes it back, kept, as the card goes; none where it is refused.
    const done = (): Undoable | undefined => {
      if (away(row) !== undefined) return undefined
      gone?.()
      const undo = { project, listed, steps: undoOf(act, listed, Date.now()) }
      keep([undo])
      return undo
    }
    if (act === "later" && untilDone) {
      done()
      doing(row, "later", { done: true })
      return
    }
    if (act === "later") {
      pickLater({
        targets: [{ project, listed }],
        anchor: card,
        onPicked: done,
      })
      return
    }
    const undo = done()
    if (act === "wake" || act === "unread") doing(row, act)
    else doing(row, "archive", { archived: act === "archive" })
    if (act === "archive" && undo) toldArchived(run, [undo])
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

/** An act on the selection: Archive, which brings back in the Archive,
 * Later, or Unread. */
export type SetAct = "archive" | "later" | "unread"

/** The act `act` is on `row`, where it may be done: Unarchive in the
 * Archive; none on one that asks or works for Archive, nor on one that
 * asks for Unread, nor on an archived one for Later. */
export function actOnRow(
  { stand, listed }: Pick<Row, "stand" | "listed">,
  act: SetAct
): Act | "unread" | undefined {
  switch (act) {
    case "archive": {
      const one = stand === "archived" ? "unarchive" : "archive"
      return actsOf(stand, listed).includes(one) ? one : undefined
    }
    case "later":
      return stand === "later" || actsOf(stand, listed).includes("later")
        ? "later"
        : undefined
    case "unread":
      return listed.mark === "asking" ? undefined : "unread"
  }
}

/** What an act on several cards is told besides its cards: the element
 * the Later picker opens at; by a key, what to do as it takes the cards
 * `keys` out of the tab; and which cards are still selected after it,
 * those it left, once it is done. */
export type OnSet = {
  anchor: Element
  gone?: (keys: ReadonlySet<string>) => void
  after?: (left: readonly Row[]) => void
}

/**
 * The Person's acts on several cards at once (ADR 0098, decision 15), as
 * on each by itself (`useActs`), but one act: one Undo takes it all back,
 * one Later time serves them all, and the Archived toast tells of them
 * all. What an act may not do stays selected, named in the toast: a card
 * that asks or works, for Archive; one whose machine the Window does not
 * reach, in the words of its Panes' pill. Where Archive may do none, a
 * toast says why, as `S` does on one card. Unread keeps every card
 * selected: those read are marked unread, or, where none is, all read.
 */
export function useSetActs(): (
  rows: readonly Row[],
  act: SetAct,
  on: OnSet
) => void {
  const run = useRun()
  const doing = useDoing()
  const away = useAway()
  const keyLabel = useKeyLabel()
  return (rows, act, { anchor, gone, after }) => {
    // What it does on each card, and what it leaves: those that ask or
    // work, which Archive refuses, and those it does not reach, each said.
    const acted: { row: Row; does: Act | "unread" }[] = []
    const stays: Row[] = []
    const refusing: Row[] = []
    const left: Left[] = []
    for (const row of rows) {
      const does = actOnRow(row, act)
      const why = does && away(row)
      if (does && why === undefined) {
        acted.push({ row, does })
        continue
      }
      stays.push(row)
      if (why) left.push({ away: why })
      else if (act === "archive" && refusalOf(row, undefined)) {
        refusing.push(row)
        left.push(row.stand === "working" ? "works" : "asks")
      }
    }
    // Unread marks unread those read, or, where none is, all read.
    const read = acted.filter(({ row }) => row.listed.seen)
    const doings = act === "unread" && read.length > 0 ? read : acted
    const said = leftSaid(left)
    // Nothing done: why, and every card stays selected.
    if (doings.length === 0) {
      const later = keyLabel(keyId("later"))
      const only = refusing.length === left.length
      const [one] = refusing
      if (only && refusing.length === 1 && one) refused(one, later)
      else {
        const why = only ? setRefusalOf(refusing, later) : said
        if (why) toast(why, { id: REFUSED })
      }
      after?.(stays)
      return
    }
    // What leaves the tab: none for Unread, nor for Later in Later.
    const going = doings.filter(
      ({ row }) =>
        act === "archive" || (act === "later" && row.stand !== "later")
    )
    /** Each done, kept as one act. */
    const done = () => {
      if (going.length > 0)
        gone?.(new Set(going.map(({ row }) => itemKey(row))))
      const now = Date.now()
      const undos = doings.map(({ row, does }) => ({
        project: row.project.id,
        listed: row.listed,
        steps: undoOf(does, row.listed, now),
      }))
      keep(undos)
      after?.(act === "unread" ? rows : stays)
      return undos
    }
    if (act === "later") {
      pickLater({
        targets: doings.map(({ row }) => ({
          project: row.project.id,
          listed: row.listed,
        })),
        anchor,
        onPicked: () => {
          done()
          if (said) toast(said, { id: REFUSED })
        },
      })
      return
    }
    const undos = done()
    for (const { row, does } of doings)
      if (does === "unread") doing(row, "unread")
      else doing(row, "archive", { archived: does === "archive" })
    const archived = undos.filter((_, at) => doings[at]!.does === "archive")
    if (archived.length > 0) toldArchived(run, archived, said)
    else if (said) toast(said, { id: REFUSED })
  }
}
