/**
 * The one list of actions (ADR 0005, decision 2). An action has a name, a
 * description in plain words and a default key; keys, buttons and later
 * the palette, the key sheet, the CLI and Agents all run the same actions.
 *
 * Alt is Banda's mod key (ADR 0005, decision 10). Keys bind by their
 * physical place (`KeyboardEvent.code`), so they work on any layout.
 */

/** A key and the mods held with it. ⌘ counts as Ctrl on a Mac. */
export type Key = {
  code: string
  alt?: boolean
  shift?: boolean
  ctrl?: boolean
}

export type Action<Context> = {
  /** Unique, with its owner first: `workspace.close`. */
  id: string
  /** The words a menu, a tooltip and the palette show. */
  title: string
  key?: Key
  run: (context: Context) => void
}

type Pressed = Pick<
  KeyboardEvent,
  "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>

export function matches(event: Pressed, key: Key): boolean {
  return (
    event.code === key.code &&
    event.altKey === (key.alt ?? false) &&
    event.shiftKey === (key.shift ?? false) &&
    (event.ctrlKey || event.metaKey) === (key.ctrl ?? false)
  )
}

/** The action a key press runs, if any. */
export function actionFor<Context>(
  actions: readonly Action<Context>[],
  event: Pressed
): Action<Context> | undefined {
  return actions.find((action) => action.key && matches(event, action.key))
}

/** How a key reads in a tooltip: `Alt+Shift+1`. */
export function keyName(key: Key): string {
  const name = key.code
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace(/^Arrow/, "")
    .replace("Enter", "Return")
  return [key.ctrl && "Ctrl", key.alt && "Alt", key.shift && "Shift", name]
    .filter(Boolean)
    .join("+")
}
