/** The Desk's keys, the same in every Pane. */
import { PROGRAM_KEYS } from "@bandaso/ui/pane"
import type { Direction } from "./layout"

export type KeyAction =
  | { do: "move"; direction: Direction }
  | { do: "split"; place: "right" | "below" }
  | { do: "close" }

const ARROWS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
}

type Keys = Pick<
  KeyboardEvent,
  "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>

/**
 * - Alt+Arrow moves the focus to the next tile.
 * - Ctrl+\ splits the focused tile to the right; with Shift, below.
 * - Ctrl+W closes the focused tile. Where a program reads the keys, as in
 *   a terminal, Ctrl+W is the program's (a shell deletes a word with it),
 *   and Ctrl+Shift+W closes the tile.
 *
 * ⌘ stands for Ctrl on a Mac.
 */
export function keyAction(event: Keys, program = false): KeyAction | null {
  const control = event.ctrlKey || event.metaKey
  const direction = ARROWS[event.key]
  if (direction && event.altKey && !control && !event.shiftKey) {
    return { do: "move", direction }
  }
  if (control && !event.altKey && event.code === "Backslash") {
    return { do: "split", place: event.shiftKey ? "below" : "right" }
  }
  // By the key's place, not its letter, so it works in every layout.
  if (
    control &&
    !event.altKey &&
    event.shiftKey === program &&
    event.code === "KeyW"
  ) {
    return { do: "close" }
  }
  return null
}

/** Whether the keys at `target` go to a program, as in a terminal: it
 * sits in an element marked with `PROGRAM_KEYS`. */
export function readByProgram(target: EventTarget | null): boolean {
  const marked = `[data-keys="${PROGRAM_KEYS["data-keys"]}"]`
  return target instanceof Element && target.closest(marked) !== null
}
