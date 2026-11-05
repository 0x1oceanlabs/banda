import { DEFAULT_KEYS, type Mod } from "@banda/contract/look"
import { createContext, useContext } from "react"
import { type Key, keyLabel } from "../lib/keys"

/**
 * The keys in force (ADR 0068): the mod, and by the id of the action each
 * runs, its key, Banda's or the one `keys.toml` gives it. A window gives
 * them; outside one, Alt and no key.
 */
export type KeysInForce = {
  mod: Mod
  byAction: ReadonlyMap<string, Key>
}

export const KeysInForce = createContext<KeysInForce>({
  mod: DEFAULT_KEYS.mod,
  byAction: new Map(),
})

/** The mod in force: what the mouse holds to move and size Panes. */
export function useMod(): Mod {
  return useContext(KeysInForce).mod
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
