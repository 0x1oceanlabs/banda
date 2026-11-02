/**
 * What the window does with the actions (ADR 0005, decision 2; their
 * type is `@banda/ui/module`'s): which one a key runs, and the Person's
 * keys over their own.
 *
 * Alt is Banda's mod key (ADR 0005, decision 10). Keys bind by their
 * physical place (`KeyboardEvent.code`), so they work on any layout.
 */
import type { Keys, Problem } from "@banda/contract/look"
import { tomlOf } from "@banda/contract/settings"
import { type Key, matches, type Pressed, sameKey } from "@banda/ui/lib/keys"
import type { Action } from "@banda/ui/module"

/** The action a key press runs, if any. */
export function actionFor<Context>(
  actions: readonly Action<Context>[],
  event: Pressed
): Action<Context> | undefined {
  return actions.find((action) =>
    action.keys?.some((key) => matches(event, key))
  )
}

/**
 * The actions with the Person's keys (`keys.toml`, ADR 0005, decision
 * 11): a key they bind leaves the action that had it and runs theirs, or
 * runs nothing when they free it. A bind to no action is named, at its
 * line, as the look's problems are.
 */
export function rebind<Context>(
  actions: readonly Action<Context>[],
  keys: Keys
): { actions: Action<Context>[]; problems: Problem[] } {
  const known = new Set(actions.map((action) => action.id))
  const binds = keys.binds.filter(
    (bind) => !bind.action || known.has(bind.action)
  )
  const problems = keys.binds
    .filter((bind) => !binds.includes(bind))
    .map((bind) => ({
      path: keys.file,
      line: bind.line,
      message: `${bind.text}: Banda has no action ${bind.action}; Alt+K lists them`,
    }))
  if (binds.length === 0) return { actions: [...actions], problems }
  return {
    actions: actions.map((action) => ({
      ...action,
      keys: [
        ...(action.keys ?? []).filter(
          (key) => !binds.some((bind) => sameKey(key, bind))
        ),
        ...binds.filter((bind) => bind.action === action.id),
      ],
    })),
    problems,
  }
}

/** How a key code reads where it is not its own name. */
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

/** How a key reads in a tooltip: `Alt+Shift+1`. */
export function keyName(key: Key): string {
  const name = NAMES[key.code] ?? key.code.replace(/^(Key|Digit|Arrow)/, "")
  return [key.ctrl && "Ctrl", key.alt && "Alt", key.shift && "Shift", name]
    .filter(Boolean)
    .join("+")
}

/** The chord no file binds (ADR 0005, decision 11), as `look/src/keys.rs`
 * has it, `RESET`: its action brings the window's own keys back. */
export const RESET_KEY: Key = {
  code: "KeyK",
  ctrl: true,
  alt: true,
  shift: true,
}

/** The file the Person's keys are in (ADR 0005, decision 11). */
export const KEYS_FILE = "keys.toml"

/** The line of keys.toml that names `key`, as `banda settings` takes it. */
export function bindPath(key: Key): string {
  return `binds.${JSON.stringify(keyName(key))}`
}

/** Writes `key` to keys.toml, running `action`, or `none` to free it; what
 * was wrong, if it was refused. */
export function writeBind(key: Key, action: string): Promise<string[]> {
  return (
    window.banda?.settings.set(KEYS_FILE, bindPath(key), tomlOf(action)) ??
    Promise.resolve([`Only the desktop app writes ${KEYS_FILE}`])
  )
}
