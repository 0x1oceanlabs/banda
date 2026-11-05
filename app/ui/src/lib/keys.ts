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

/** Whether the window runs on a Mac, where ⌘ does what Ctrl does. */
export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform)

/** How a key code reads where it is not its own name, as `keys.toml`
 * writes it (`look/src/keys.rs`). */
const NAMES: Record<string, string> = {
  Enter: "Return",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Backslash: "\\",
  IntlBackslash: "<",
}

/** How a Mac writes a key that has a sign of its own. */
const MAC_NAMES: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Enter: "↩",
  Backspace: "⌫",
  Delete: "⌦",
  Escape: "⎋",
  Tab: "⇥",
  PageUp: "⇞",
  PageDown: "⇟",
  Home: "↖",
  End: "↘",
}

/** The key's own name, as `keys.toml` writes it: `R`, `5`, `Left`. */
function nameOf(code: string): string {
  return NAMES[code] ?? code.replace(/^(Key|Digit|Arrow)/, "")
}

/**
 * A key's caps as they are pressed, mods first (ADR 0068, decision 4):
 * `Ctrl`, `Alt`, `Shift`, then the key; on a Mac its signs in Apple's
 * order, `⌃ ⌥ ⇧`, then the key, an arrow as its arrow. Banda's keys: an
 * App's Ctrl that is ⌘ on a Mac still reads as `MOD` says.
 */
export function keyCaps(key: Key, mac = isMac): string[] {
  const caps = mac
    ? [key.ctrl && "⌃", key.alt && "⌥", key.shift && "⇧"]
    : [key.ctrl && "Ctrl", key.alt && "Alt", key.shift && "Shift"]
  const name = (mac && MAC_NAMES[key.code]) || nameOf(key.code)
  return [...caps.filter((cap): cap is string => !!cap), name]
}

/** How a key reads to the Person, in a tooltip or a menu: `Alt+Shift+1`,
 * or `⌥⇧1` on a Mac. Never "Mod": the key as it is pressed. */
export function keyLabel(key: Key, mac = isMac): string {
  return keyCaps(key, mac).join(mac ? "" : "+")
}

/** A key as `keys.toml` writes it, on every system: `Ctrl+Alt+Shift+R`. */
export function keyText(key: Key): string {
  return [key.ctrl && "Ctrl", key.alt && "Alt", key.shift && "Shift"]
    .filter(Boolean)
    .concat(nameOf(key.code))
    .join("+")
}

/** How a menu writes the key held for a shortcut: ⌘ on a Mac. */
export const MOD = isMac ? "⌘" : "Ctrl+"

/** A field: it takes keys of its own, and keeps the system's own menu
 * and copy. */
export const FIELDS =
  "input,textarea,select,[contenteditable=true],[contenteditable=plaintext-only],[role=textbox],[role=combobox],[role=spinbutton]"
