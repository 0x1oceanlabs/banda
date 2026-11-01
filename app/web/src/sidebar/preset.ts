/**
 * The preset the Person picked in the view menu, kept in this window's
 * storage until the engine keeps it in `sidebar.toml` (ADR 0008, step 2).
 */
import { useCallback, useState } from "react"
import { PRESET_NAMES, type Preset } from "./settings"

const KEY = "bandaso.sidebar.preset"

function read(): Preset {
  try {
    const kept = localStorage.getItem(KEY)
    return PRESET_NAMES.find((name) => name === kept) ?? "inbox"
  } catch {
    return "inbox"
  }
}

export function usePreset(): [Preset, (preset: Preset) => void] {
  const [preset, setPreset] = useState(read)
  const pick = useCallback((next: Preset) => {
    setPreset(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // It holds for this window.
    }
  }, [])
  return [preset, pick]
}
