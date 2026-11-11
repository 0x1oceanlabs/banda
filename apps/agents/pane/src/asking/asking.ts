/**
 * A Question as the Person reads it (ADR 0058, decision 6): what it asks
 * in words with the command it is about apart, its answers and their keys,
 * and the one line it folds to once answered. Pure, so plain tests cover
 * it.
 */
import type { Choice, Item, ToolKind } from "@banda/contract/agents"
import { summary } from "./form"
import type { Asked, QuestionBody } from "../thread/state"

/** A title without markdown's code marks: a Harness writes a command as
 * `` `pnpm test` ``. */
export function plain(title: string): string {
  return title.replace(/`+/g, "").trim()
}

/** The command or path a title names in code marks, else the title: a
 * permission's title may say it in words around it, "Allow Claude Code to
 * run `pnpm test`?". */
export function named(title: string): string {
  return title.match(/`+([^`]+)`+/)?.[1]?.trim() || plain(title)
}

/** What a tool call does, as a permission asks for it. */
const ALLOWS: Partial<Record<ToolKind, string>> = {
  execute: "run a command",
  edit: "edit a file",
  delete: "delete a file",
  move: "move a file",
  read: "read a file",
  search: "search the files",
  fetch: "fetch a page",
}

/** What a Question asks in words, and the command or file it is about in
 * mono when it asks for a tool call: "Allow Claude Code to run a
 * command?", `pnpm test`. A sub-agent's says the command its call runs,
 * in mono, whoever asks; the drawer draws it once when that is all it
 * says (ADR 0103, decision 28). Any other asks in its own words. */
export function wordsOf(
  question: QuestionBody,
  about: ToolKind | undefined,
  name: string
): { words: string; detail?: string } {
  const title = plain(question.title)
  if (question.form || question.plan !== undefined) return { words: title }
  if (question.sub !== undefined)
    return { words: title, detail: named(question.title) }
  const does = about && ALLOWS[about]
  if (!does) return { words: title }
  return { words: `Allow ${name} to ${does}?`, detail: named(question.title) }
}

/** The kind of tool call Question `asked` asks about: the call of its turn
 * with its title, or else the last that waits. A sub-agent's asks about
 * none of the Agent's calls: its own are in its lane. */
export function aboutOf(items: Item[], asked: Asked): ToolKind | undefined {
  if (asked.body.sub !== undefined) return undefined
  const at = items.findIndex((item) => item.id === asked.id)
  const calls = items
    .slice(0, at < 0 ? items.length : at)
    .flatMap((item) =>
      item.turn === asked.turn && item.body.kind === "tool" ? [item.body] : []
    )
  const title = plain(asked.body.title)
  const named = calls.findLast((call) => plain(call.title) === title)
  return (named ?? calls.findLast((call) => call.status === "pending"))?.tool
}

/** A Question's answers as the drawer lays them out: the one that says no
 * once, with Esc; the main one, the first that allows once, with ⏎; the
 * others that go once; and those the Harness keeps for next time, under
 * More. Keys 1–9 pick them in the Harness's order. */
export function answersOf(choices: Choice[]): {
  decline?: Choice
  main?: Choice
  others: Choice[]
  kept: Choice[]
} {
  const once = choices.filter((choice) => !choice.always)
  const main = once.find((choice) => choice.allows)
  const decline = once.find((choice) => !choice.allows)
  return {
    decline,
    main,
    others: once.filter((choice) => choice !== main && choice !== decline),
    kept: choices.filter((choice) => choice.always),
  }
}

/** The one line an answered Question folds to, as an answered Issue does:
 * "Allowed: pnpm test", "Declined: …", "You chose: …"; a form's answers
 * open from it. */
export type Folded = {
  kind: "allowed" | "declined" | "chose" | "answered" | "skipped" | "closed"
  text: string
  /** A form's answers, by field. */
  values?: { id: string; title: string; value: string }[]
}

export function foldedOf(question: QuestionBody): Folded {
  const { choices, form, state, answer, values } = question
  const title = plain(question.title)
  if (state !== "answered")
    return { kind: "closed", text: `No longer asked: ${title}` }
  if (form) {
    if (!values) return { kind: "skipped", text: `Skipped: ${title}` }
    const filledIn = summary(form, values)
    return filledIn.length > 0
      ? { kind: "answered", text: `Answered: ${title}`, values: filledIn }
      : { kind: "answered", text: `Answered: ${title} · nothing filled in` }
  }
  const chosen = choices.find((choice) => choice.id === answer)
  // Yes or no to one thing reads as what was allowed; a choice among more,
  // or how to carry out a plan, reads as the choice.
  const yesOrNo = choices.filter((c) => c.allows && !c.always).length <= 1
  if (!chosen || !yesOrNo || question.plan !== undefined)
    return {
      kind: "chose",
      text: `You chose: ${chosen ? plain(chosen.name) : answer}`,
    }
  const what = named(question.title)
  if (!chosen.allows) return { kind: "declined", text: `Declined: ${what}` }
  return {
    kind: "allowed",
    text: `${chosen.always ? "Always allowed" : "Allowed"}: ${what}`,
  }
}

/** A key pressed in a Thread Pane while a Question waits, as far as it
 * matters to the Question. */
export type Press = {
  key: string
  /** Ctrl, ⌘, Alt or Shift is held. */
  mods: boolean
  /** An input method is composing text. */
  composing: boolean
  /** Something in the Pane acted on it already. */
  taken: boolean
  /** Where the focus is: the composer's text, another field, a control
   * (a button, a link, a choice), or none of these. */
  on: "composer" | "field" | "control" | "other"
  /** The composer held a message as the key went down: Enter sends it. */
  written: boolean
}

/**
 * The answer a key gives a Question that waits, if any: Esc says no, Enter
 * gives the main answer. A key something else in the Pane claims stays
 * its own: Esc a menu, the find bar or a dialog took; Enter a field or a
 * control takes, or the composer while a message is written in it. The
 * composer's text takes every Enter and Esc, but does nothing with Enter
 * when nothing is written, nor with Esc when no menu of its is open; an
 * open menu keeps its Esc from the Pane.
 */
export function keyAnswer(press: Press): "decline" | "main" | undefined {
  if (press.mods || press.composing) return undefined
  switch (press.key) {
    case "Escape":
      return press.taken && press.on !== "composer" ? undefined : "decline"
    case "Enter":
      if (press.on === "composer") return press.written ? undefined : "main"
      return press.taken || press.on !== "other" ? undefined : "main"
    default:
      return undefined
  }
}

/** The choice key `key` picks, 1–9 in the Harness's order. */
export function choiceAt(choices: Choice[], key: string): Choice | undefined {
  return /^[1-9]$/.test(key) ? choices[Number(key) - 1] : undefined
}
