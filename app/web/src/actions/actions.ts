/**
 * The one list of actions (ADR 0005, decision 2). An action has a name, a
 * description in plain words and a default key; keys, buttons and later
 * the palette, the key sheet, the CLI and Agents all run the same actions.
 *
 * Alt is Banda's mod key (ADR 0005, decision 10). Keys bind by their
 * physical place (`KeyboardEvent.code`), so they work on any layout.
 */
import type { Keys, Problem } from "@banda/contract/look"
import { type Key, matches, type Pressed, sameKey } from "@banda/ui/lib/keys"

export type Action<Context> = {
  /** Unique, with its owner first: `workspace.close`. */
  id: string
  /** The words a menu, a tooltip and the palette show. */
  title: string
  /** The keys that run it: its own, then the Person's (`keys.toml`). */
  keys?: readonly Key[]
  /** Its key works while a dialog is open, as the Banda menu's own do;
   * any other key there is the dialog's. */
  overDialogs?: true
  run: (context: Context) => void
}

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
