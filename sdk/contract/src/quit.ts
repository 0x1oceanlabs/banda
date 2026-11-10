/**
 * What Quit Banda asks while Agents work, in one set of words everywhere
 * (ADR 0086, decision 3): the window's page, macOS's dialog and the menu
 * bar, as `banda stop` asks in a terminal (engine/src/quit.rs, which
 * writes them). Cancel is the default: a stray Quit leaves the Agents
 * working. With none at work, Quit asks nothing.
 */
import { QUIT_WORDS } from "./generated/QUIT"

/** The question: its title, the line under it, and its two buttons. */
export type QuitAsks = {
  readonly title: string
  readonly detail: string
  /** Quits, and stops the Agents. */
  readonly quit: string
  /** Leaves them working: the default. */
  readonly cancel: string
}

/** What Quit asks while `working` Agents work on this machine, a Mac
 * (`mac`) or another computer; none while nobody works. */
export function quitAsks(working: number, mac: boolean): QuitAsks | null {
  if (!(working > 0)) return null
  const said = working === 1 ? QUIT_WORDS.one : QUIT_WORDS.many
  const here = mac ? QUIT_WORDS.mac : QUIT_WORDS.elsewhere
  return {
    title: said.title.replace("{n}", String(working)).replace("{here}", here),
    detail: said.detail,
    quit: QUIT_WORDS.quit,
    cancel: QUIT_WORDS.cancel,
  }
}
