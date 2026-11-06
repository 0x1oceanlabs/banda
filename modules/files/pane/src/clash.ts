/**
 * A clash, as the Person answers it (ADR 0073, decision 10): a name taken
 * in the folder a move or a copy goes to asks Replace, Keep both or Skip,
 * one clash after another, or once for all those left. Pure, so plain
 * tests cover it.
 */
import type { Clash, Clashing } from "@banda/contract/files"

/** What the Person may answer: never to be asked again. */
export type Answer = Exclude<Clash, "ask">

/** The clashes being asked about: the one shown, and those answered. */
export type Asking = {
  clashes: readonly Clashing[]
  at: number
  answers: Readonly<Record<string, Answer>>
}

export function asking(clashes: readonly Clashing[]): Asking {
  return { clashes, at: 0, answers: {} }
}

/** After the Person answered the clash shown, for it alone or for it and
 * all after it: the next to ask, or every answer. */
export function answered(
  now: Asking,
  answer: Answer,
  forAll: boolean
): { next: Asking } | { answers: Record<string, Answer> } {
  const answers = { ...now.answers }
  const until = forAll ? now.clashes.length : now.at + 1
  for (const clash of now.clashes.slice(now.at, until))
    answers[clash.path] = answer
  return until >= now.clashes.length
    ? { answers }
    : { next: { ...now, at: until, answers } }
}

/** What the dialog asks of the clash shown. */
export function question(now: Asking, folder: string): string {
  const clash = now.clashes[now.at]
  const kind = clash.folder ? "A folder" : "An item"
  return `${kind} named “${clash.name}” is already in “${folder}”.`
}
