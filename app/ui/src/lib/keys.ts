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

/** Whether `a` and `b` are the same key with the same mods. */
export function sameKey(a: Key, b: Key): boolean {
  return (
    a.code === b.code &&
    !!a.alt === !!b.alt &&
    !!a.shift === !!b.shift &&
    !!a.ctrl === !!b.ctrl
  )
}

/** Whether `event` presses `key`, with exactly its mods held. */
export function matches(event: Pressed, key: Key): boolean {
  return (
    event.code === key.code &&
    event.altKey === (key.alt ?? false) &&
    event.shiftKey === (key.shift ?? false) &&
    (event.ctrlKey || event.metaKey) === (key.ctrl ?? false)
  )
}

/** Whether `code` is an Alt key, left or right. */
export function isAlt(code: string): boolean {
  return code === "AltLeft" || code === "AltRight"
}

/** Keys that are only mods: a key to bind comes with them, not alone. */
const MODS = new Set(["Alt", "AltGraph", "Control", "Shift", "Meta"])

/**
 * What a press gives a key waiting to be bound: the key; nothing while
 * only mods are held; or why it cannot be one. Super is the desktop's.
 */
export function keyToBind(
  event: Pressed & Pick<KeyboardEvent, "key">
): { key: Key } | { refused: string } | undefined {
  if (MODS.has(event.key)) return undefined
  if (event.metaKey)
    return { refused: "Super is the desktop's: hold Alt or Ctrl instead" }
  return {
    key: {
      code: event.code,
      alt: event.altKey,
      shift: event.shiftKey,
      ctrl: event.ctrlKey,
    },
  }
}
