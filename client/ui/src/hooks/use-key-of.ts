import { DEFAULT_KEYS, type Mod } from "@banda/contract/look"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react"
import { holdsAlone, type Key, keyLabel, type Pressed } from "../lib/keys"

/**
 * The keys in force (ADR 0068): the mod, and by the id of the action each
 * runs, its key, Banda's or the one `keys.toml` gives it; and every key
 * by the scope its action works in, "" for the window's (ADR 0071), but
 * those a browser's page keeps (`Action.pageKeeps`). A window gives them;
 * outside one, Alt and no key.
 */
export type KeysInForce = {
  mod: Mod
  byAction: ReadonlyMap<string, Key>
  byScope: ReadonlyMap<string, readonly Key[]>
}

export const KeysInForce = createContext<KeysInForce>({
  mod: DEFAULT_KEYS.mod,
  byAction: new Map(),
  byScope: new Map(),
})

/** The keys in force while the focus is in `scope`: its own, then the
 * window's. */
export function useKeysIn(scope: string): readonly Key[] {
  const { byScope } = useContext(KeysInForce)
  return useMemo(
    () => [...(byScope.get(scope) ?? []), ...(byScope.get("") ?? [])],
    [byScope, scope]
  )
}

/** The mod in force: what the mouse holds to move and size Panes. */
export function useMod(): Mod {
  return useContext(KeysInForce).mod
}

/** Whether a press holds the mod in force alone, as the mouse's moves
 * do (`holdsAlone`): one function for a listener set up once, which reads
 * the mod as the keys change. */
export function useHoldsMod(): (
  event: Pick<Pressed, "altKey" | "ctrlKey" | "metaKey">
) => boolean {
  const mod = useMod()
  const ref = useRef(mod)
  useEffect(() => {
    ref.current = mod
  }, [mod])
  return useCallback((event) => holdsAlone(event, ref.current), [])
}

/** The key in force that runs an action, by the action's id. */
export function useKeyOf(): (action: string) => Key | undefined {
  const { byAction } = useContext(KeysInForce)
  return (action) => byAction.get(action)
}

/** How the key that runs an action reads now, by the action's id: alone,
 * or after `words` for a tooltip, as `Close (Alt+W)`. */
type KeyLabel = {
  (action: string): string | undefined
  (action: string, words: string): string
}

/**
 * The key of an action as the Person presses it (ADR 0068, decision 4),
 * for a tooltip or a menu's row. Nothing names a key in its own words:
 * the Person may have moved it.
 */
export function useKeyLabel(): KeyLabel {
  const { byAction } = useContext(KeysInForce)
  return ((action: string, words?: string) => {
    const key = byAction.get(action)
    const label = key && keyLabel(key)
    if (words === undefined) return label
    return label ? `${words} (${label})` : words
  }) as KeyLabel
}
