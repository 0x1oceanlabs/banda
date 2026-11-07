/**
 * What the check makes of a page it laid out (ADR 0037, decision 3): the
 * console's lines as the Agent reads them, and the picture's size. It
 * needs no Electron, so its tests do not load it.
 */
import type { Logged } from "@banda/contract/agents"

/** The longest side of a picture: what a model reads of one at most, so
 * nothing larger is sent only to be shrunk. */
const LONGEST_SIDE = 1_568
/** How many console lines it keeps, and how much of each. */
const LINES = 20
const LONGEST_LINE = 500

/** A console line, as the Agent reads it. */
export function logged(level: string, message: string): Logged | undefined {
  if (level !== "error" && level !== "warning") return undefined
  const text =
    message.length > LONGEST_LINE
      ? `${message.slice(0, LONGEST_LINE)}…`
      : message
  return { level, text }
}

/** The console's first lines, and one that says how many more there
 * were; it keeps no more than it answers. */
export class Logs {
  readonly #lines: Logged[] = []
  #more = 0

  hear(level: string, message: string): void {
    const line = logged(level, message)
    if (!line) return
    if (this.#lines.length < LINES) this.#lines.push(line)
    else this.#more += 1
  }

  said(): Logged[] {
    if (this.#more === 0) return this.#lines
    const more = {
      level: "warning",
      text: `${this.#more} more lines left out.`,
    }
    return [...this.#lines, more]
  }
}

/** A picture's size within [LONGEST_SIDE], its shape kept. */
export function fitted(width: number, height: number) {
  const scale = Math.min(1, LONGEST_SIDE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}
