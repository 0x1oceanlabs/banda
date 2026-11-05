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
import {
  type Key,
  keyText,
  matches,
  type Pressed,
  sameKey,
} from "@banda/ui/lib/keys"
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
 * Actions by the id they had before, which a bind may still name, for one
 * stable release: it runs the action, and says what it is called now.
 */
const RENAMED: Readonly<Record<string, string>> = {
  // ADR 0069: Settled is the archive.
  "sidebar.settle": "sidebar.archive",
}

/**
 * The actions with the Person's keys (`keys.toml`, ADR 0005, decision
 * 11): a key they bind leaves the action that had it and runs theirs, or
 * runs nothing when they free it. A bind to no action is named, at its
 * line, as the look's problems are, and so is one to an action's old id.
 */
export function rebind<Context>(
  actions: readonly Action<Context>[],
  keys: Keys
): { actions: Action<Context>[]; problems: Problem[] } {
  const known = new Set(actions.map((action) => action.id))
  const binds: Keys["binds"] = []
  const problems: Problem[] = []
  const say = (bind: Keys["binds"][number], message: string) =>
    problems.push({
      path: keys.file,
      line: bind.line,
      message: `${bind.text}: ${message}`,
    })
  for (const bind of keys.binds) {
    const action = bind.action && (RENAMED[bind.action] ?? bind.action)
    if (action && !known.has(action)) {
      say(bind, `Banda has no action ${action}; the key sheet lists them`)
      continue
    }
    if (action !== bind.action)
      say(bind, `${bind.action} is called ${action} now`)
    binds.push({ ...bind, action })
  }
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

/** Each action's first key, by the action's id, for what names it
 * (ADR 0068, decision 4). */
export function keysOf<Context>(
  actions: readonly Action<Context>[]
): ReadonlyMap<string, Key> {
  return new Map(
    actions.flatMap((action) => {
      const key = action.keys?.[0]
      return key ? [[action.id, key] as const] : []
    })
  )
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
  return `binds.${JSON.stringify(keyText(key))}`
}

/** Writes `key` to keys.toml, running `action`, or `none` to free it; what
 * was wrong, if it was refused. */
export function writeBind(key: Key, action: string): Promise<string[]> {
  return (
    window.banda?.settings.set(KEYS_FILE, bindPath(key), tomlOf(action)) ??
    Promise.resolve([`Only the desktop app writes ${KEYS_FILE}`])
  )
}
