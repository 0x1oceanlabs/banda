/**
 * A key and how a press matches it, for Banda's actions and a module's own
 * keys alike. Keys bind by their physical place (`KeyboardEvent.code`), so
 * they work on any layout.
 */

import type { JsonValue } from "@banda/contract"
import type { Mod } from "@banda/contract/look"

export type { Mod }

/** A key and the mods held with it, matched exactly (ADR 0068, decision
 * 3). Super is ⌘ on a Mac. */
export type Key = {
  code: string
  alt?: boolean
  shift?: boolean
  ctrl?: boolean
  super?: boolean
  /** Ctrl, or ⌘ on a Mac: an App's own key written so, as the browser's
   * `Ctrl+T`. */
  primary?: boolean
  /** Held with the mod (ADR 0068, decision 2), as Banda's own keys are:
   * `realKey` makes it the mod's keys in force. */
  mod?: boolean
  /** With the mod, one key more: the first of Ctrl, Super and Alt the
   * mod does not hold. */
  more?: boolean
  /** What it gives its action: a line of keys.toml's args (ADR 0071). */
  args?: { readonly [name: string]: JsonValue }
}

/** The keys a mod may hold, in the order one more is taken. */
const MORE = ["ctrl", "super", "alt"] as const

/** The press's flag for each key a mod may hold. */
const FLAGS = { alt: "altKey", ctrl: "ctrlKey", super: "metaKey" } as const

/** Whether `event` holds the mod and no other of Alt, Ctrl and Super, as
 * the mouse's moves do (ADR 0068, decision 3): one key more makes the
 * press the Pane's program's. A key of the mod let go still says it is
 * held on its own key up, so that one does not. */
export function holdsAlone(
  event: Pick<Pressed, "altKey" | "ctrlKey" | "metaKey"> &
    Partial<Pick<KeyboardEvent, "type" | "code">>,
  mod: Mod
): boolean {
  if (event.type === "keyup" && isModKey(event.code ?? "", mod)) return false
  return MORE.every((one) => event[FLAGS[one]] === mod[one])
}

/** The keys each key of a mod is, left and right. */
const SIDES = {
  alt: ["AltLeft", "AltRight"],
  ctrl: ["ControlLeft", "ControlRight"],
  super: ["MetaLeft", "MetaRight", "OSLeft", "OSRight"],
} as const

/** Whether `code` is a key the mod holds, left or right. */
export function isModKey(code: string, mod: Mod): boolean {
  return MORE.some(
    (one) => mod[one] && (SIDES[one] as readonly string[]).includes(code)
  )
}

/** The mod with one key more (ADR 0068, decision 2): the first of Ctrl,
 * Super and Alt it does not hold; none for a mod of all three. */
export function withMore(mod: Mod): Mod | undefined {
  const one = MORE.find((each) => !mod[each])
  return one && { ...mod, [one]: true }
}

/**
 * The key as it is pressed with the mod: a key held with the mod holds
 * its keys, and one key more besides when it says so. A key not held with
 * the mod is as it is written.
 */
export function realKey(key: Key, mod: Mod): Key {
  if (!key.mod && !key.more) return key
  const held = (key.more && withMore(mod)) || mod
  return { code: key.code, shift: key.shift, ...held }
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
    !!(a.ctrl || a.primary) === !!(b.ctrl || b.primary) &&
    !!a.super === !!b.super
  )
}

/** Whether `event` presses `key`, with exactly its mods held; a primary
 * key takes Ctrl, or ⌘ as well on a Mac. */
export function matches(event: Pressed, key: Key, mac = isMac): boolean {
  const ctrl = key.primary
    ? mac
      ? event.ctrlKey || event.metaKey
      : event.ctrlKey && !event.metaKey
    : event.ctrlKey === !!key.ctrl && event.metaKey === !!key.super
  return (
    event.code === key.code &&
    event.altKey === !!key.alt &&
    event.shiftKey === !!key.shift &&
    ctrl
  )
}

/** Keys that are only mods: a key to bind comes with them, not alone. */
const MODS = new Set(["Alt", "AltGraph", "Control", "Shift", "Meta"])

/** What a press gives a key waiting to be bound: the key as it is
 * pressed, Super too; nothing while only mods are held. keys.toml says
 * what it refuses. */
export function keyToBind(
  event: Pressed & Pick<KeyboardEvent, "key">
): Key | undefined {
  if (MODS.has(event.key)) return undefined
  return {
    code: event.code,
    alt: event.altKey,
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    super: event.metaKey,
  }
}

/** Whether the window runs on a Mac, where ⌘ does what Ctrl does. */
export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform)

/** How a key code reads where it is not its own name, as `keys.toml`
 * writes it (`platform/look/src/keys.rs`). */
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
    ? [
        key.ctrl && "⌃",
        key.alt && "⌥",
        key.shift && "⇧",
        (key.super || key.primary) && "⌘",
      ]
    : [
        (key.ctrl || key.primary) && "Ctrl",
        key.alt && "Alt",
        key.super && "Super",
        key.shift && "Shift",
      ]
  const name = (mac && MAC_NAMES[key.code]) || nameOf(key.code)
  return [...caps.filter((cap): cap is string => !!cap), name]
}

/** How a key reads to the Person, in a tooltip or a menu: `Alt+Shift+1`,
 * or `⌥⇧1` on a Mac. Never "Mod": the key as it is pressed. */
export function keyLabel(key: Key, mac = isMac): string {
  return keyCaps(key, mac).join(mac ? "" : "+")
}

/** Whether two mods, or a key's mods, hold the same keys. */
export function sameMod(a: Mod, b: Mod): boolean {
  return MORE.every((one) => a[one] === b[one])
}

/** A mod as keys.toml writes it: `Ctrl+Alt+Super`, in that order. */
export function modText(mod: Mod): string {
  return [mod.ctrl && "Ctrl", mod.alt && "Alt", mod.super && "Super"]
    .filter(Boolean)
    .join("+")
}

/** How a mod reads: `Ctrl+Alt`, or `⌃⌥` on a Mac. */
export function modLabel(mod: Mod, mac = isMac): string {
  return keyCaps({ code: "", ...mod }, mac)
    .slice(0, -1)
    .join(mac ? "" : "+")
}

/** A key as `keys.toml` writes it, on every system: `Ctrl+Alt+Shift+R`. */
export function keyText(key: Key): string {
  return [
    (key.ctrl || key.primary) && "Ctrl",
    key.alt && "Alt",
    key.super && "Super",
    key.shift && "Shift",
  ]
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
