/**
 * A key and how a press matches it, for Banda's actions and a module's own
 * keys alike. Keys bind by their physical place (`KeyboardEvent.code`), so
 * they work on any layout.
 */

/** A key and the mods held with it. ⌘ counts as Ctrl on a Mac. */
export type Key = {
  code: string
  alt?: boolean
  shift?: boolean
  ctrl?: boolean
}

/** A key press, as the DOM tells it. */
export type Pressed = Pick<
  KeyboardEvent,
  "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>

/** Whether `event` presses `key`, with exactly its mods held. */
export function matches(event: Pressed, key: Key): boolean {
  return (
    event.code === key.code &&
    event.altKey === (key.alt ?? false) &&
    event.shiftKey === (key.shift ?? false) &&
    (event.ctrlKey || event.metaKey) === (key.ctrl ?? false)
  )
}
