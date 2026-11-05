import { createContext, useContext } from "react"
import { type Key, keyLabel } from "../lib/keys"

/**
 * The keys in force, by the id of the action each runs: Banda's, or the
 * one `keys.toml` gives it. A window gives them; outside one there are
 * none.
 */
export const ActionKeys = createContext<ReadonlyMap<string, Key>>(new Map())

/** The key in force that runs an action, by the action's id. */
export function useKeyOf(): (action: string) => Key | undefined {
  const keys = useContext(ActionKeys)
  return (action) => keys.get(action)
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
  const keys = useContext(ActionKeys)
  return ((action: string, words?: string) => {
    const key = keys.get(action)
    const label = key && keyLabel(key)
    if (words === undefined) return label
    return label ? `${words} (${label})` : words
  }) as KeyLabel
}
