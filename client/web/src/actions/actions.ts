/**
 * What the window does with the actions (ADR 0005, decision 2; their
 * type is `@banda/ui/module`'s): which one a key runs, with the keys in
 * force the look makes (ADR 0071, decision 4).
 *
 * Keys bind by their physical place (`KeyboardEvent.code`), so they work
 * on any layout.
 */
import {
  type ActionKeys,
  DEFAULT_KEYS,
  type Keys,
  type Mod,
} from "@banda/contract/look"
import { tomlOf } from "@banda/contract/settings"
import {
  type Key,
  keyText,
  matches,
  type Pressed,
  realKey,
  sameMod,
  withMore,
} from "@banda/ui/lib/keys"
import type { KeysInForce } from "@banda/ui/hooks/use-key-of"
import { actInScope } from "@banda/ui/hooks/use-scope"
import type { Action, Args } from "@banda/ui/module"
import { device } from "../boot"

/** The scopes whose keys work with the mod still held too, and the mod. */
export type Held = { mod: Mod; scopes: ReadonlySet<string> }

/**
 * The action a key press runs, if any, and what its key gives it: one of
 * the scopes the focus is in, narrowest first, then the window's (ADR
 * 0071, decision 1). A press no key takes may be a `held` scope's plain
 * key with the mod still held, as the launcher's T after Alt+N.
 */
export function pressFor<Context>(
  actions: readonly Action<Context>[],
  event: Pressed,
  scopes: readonly string[] = [],
  held?: Held
): { action: Action<Context>; args?: Args } | undefined {
  const find = (
    among: readonly (string | undefined)[],
    takes: (key: Key) => boolean
  ) => {
    for (const scope of among)
      for (const action of actions) {
        if (action.scope !== scope) continue
        const key = action.keys?.find(takes)
        if (key) return { action, args: key.args }
      }
    return undefined
  }
  const exact = find([...scopes, undefined], (key) => matches(event, key))
  if (exact || !held) return exact
  const plain = (key: Key) =>
    !key.alt && !key.ctrl && !key.super && !key.primary
  return find(
    scopes.filter((scope) => held.scopes.has(scope)),
    (key) =>
      !key.mod &&
      !key.more &&
      plain(key) &&
      matches(event, realKey({ ...key, mod: true }, held.mod))
  )
}

/**
 * Runs a scope's action in its scope (ADR 0071, decision 1): the key is
 * taken when the scope took it, else left to its widget, as an arrow
 * inside a text. Whether the action was a scope's. Taken, it still goes
 * on through the Pane, as a widget's own key does, so the Pane may read
 * it: Enter in an empty composer answers the Question that waits.
 */
export function inScope<Context>(
  { action, args }: { action: Action<Context>; args?: Args },
  event: KeyboardEvent
): boolean {
  if (!action.scope) return false
  if (actInScope(action.scope, action.id, args, event)) event.preventDefault()
  return true
}

/** Whether `action`, given `args`, acts as the Person (ADR 0083,
 * decision 3): whatever it is given, or given one of the args that make
 * it so, as `thread.new`'s `ask`; as the engine's `Action::as_person`. */
export function actsAsPerson<Context>(
  action: Action<Context>,
  args?: Args
): boolean {
  const runs = action.runsAsPerson
  if (runs === true) return true
  return runs?.some((name) => args?.[name] !== undefined) ?? false
}

/** The action a key press runs, if any. */
export function actionFor<Context>(
  actions: readonly Action<Context>[],
  event: Pressed
): Action<Context> | undefined {
  return pressFor(actions, event)?.action
}

/**
 * The actions with the keys in force, as the look makes them (ADR 0071,
 * decision 4): Banda's with the mod, the Person's lines over them, with
 * what each gives its action. With none, before the look comes or after
 * the reset chord, Banda's own, Alt the mod.
 */
export function withKeys<Context>(
  actions: readonly Action<Context>[],
  inForce: readonly ActionKeys[]
): Action<Context>[] {
  if (inForce.length === 0)
    return actions.map((action) => ({
      ...action,
      keys: action.keys?.map((key) => realKey(key, DEFAULT_KEYS.mod)),
    }))
  const keys = new Map(inForce.map((one) => [one.id, one.keys]))
  return actions.map((action) => ({
    ...action,
    keys: keys.get(action.id) ?? [],
  }))
}

/** A line of the Person's moved with a new mod (ADR 0068, decision 5):
 * to its new key, or out, for a `none`, whose key is no longer Banda's. */
export type Move = { bind: Keys["binds"][number]; to?: Key }

/** The Person's lines that hold the mod `from`, alone or with one key
 * more, and where each goes with the mod `to`, at the same level. */
export function movesOf(binds: Keys["binds"], from: Mod, to: Mod): Move[] {
  const more = withMore(from)
  return binds.flatMap((bind): Move[] => {
    const level = sameMod(bind, from)
      ? { mod: true }
      : more && sameMod(bind, more)
        ? { more: true }
        : undefined
    if (!level) return []
    if (!bind.action) return [{ bind }]
    const written = { code: bind.code, shift: bind.shift, ...level }
    return [{ bind, to: realKey(written, to) }]
  })
}

/** The keys in force for what names them (ADR 0068, decision 4), from
 * the actions with their keys in force: the mod, each action's first key
 * by its id, and every key by the scope its action works in, but those a
 * browser's page keeps (`pageKeeps`), which main never takes from it. */
export function keysInForce<Context>(
  mod: Mod,
  actions: readonly Action<Context>[]
): KeysInForce {
  const byScope = new Map<string, Key[]>()
  for (const action of actions) {
    if (action.pageKeeps) continue
    const scope = action.scope ?? ""
    const keys = byScope.get(scope) ?? []
    keys.push(...(action.keys ?? []))
    byScope.set(scope, keys)
  }
  return {
    mod,
    byAction: new Map(
      actions.flatMap((action) => {
        const key = action.keys?.[0]
        return key ? [[action.id, key] as const] : []
      })
    ),
    byScope,
  }
}

/** The chord no file binds (ADR 0005, decision 11), as `platform/look/src/keys.rs`
 * has it, `RESET`: its action brings the window's own keys back. */
export const RESET_KEY: Key = {
  code: "KeyK",
  ctrl: true,
  alt: true,
  shift: true,
}

/** The file the Person's keys are in (ADR 0005, decision 11). */
export const KEYS_FILE = "keys.toml"

/** A key of keys.toml: in `[binds]`, or in its scope's table,
 * `[binds.composer]` (ADR 0071, decision 1). */
type Bound = Key & { scope?: string }

/** The line of keys.toml that names `key`, as `banda settings` takes it. */
export function bindPath({ scope, ...key }: Bound): string {
  return ["binds", scope, JSON.stringify(keyText(key))]
    .filter(Boolean)
    .join(".")
}

/** Writes `key` to keys.toml, running `action`, or `none` to free it; what
 * was wrong, if it was refused. */
export function writeBind(key: Bound, action: string): Promise<string[]> {
  return device.settings.writes()
    ? device.settings.set(KEYS_FILE, bindPath(key), tomlOf(action))
    : Promise.resolve([`Only the desktop app writes ${KEYS_FILE}`])
}
