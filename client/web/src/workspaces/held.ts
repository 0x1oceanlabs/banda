/**
 * Whether the mod is held, as Banda's, on the page's root (`data-mod`): a
 * browser's page lets the mouse through then, so the mod and the buttons
 * move and size Panes over it too (ADR 0025, decision 5; ADR 0068,
 * decision 3). A page tells the window of its mod as well
 * (@banda/browser-desktop); the pointer moving without it, or the window
 * losing the keys, says it is let go.
 */
import { useEffect } from "react"
import { useMod } from "@banda/ui/hooks/use-key-of"
import { holdsAlone } from "@banda/ui/lib/keys"

export function useModHeld() {
  const { alt, ctrl, super: sup } = useMod()
  useEffect(() => {
    const mod = { alt, ctrl, super: sup }
    const html = document.documentElement
    const set = (held: boolean) => {
      if (held === "mod" in html.dataset) return
      if (held) html.dataset.mod = ""
      else delete html.dataset.mod
    }
    const onKey = (event: KeyboardEvent) => set(holdsAlone(event, mod))
    const onPointer = (event: PointerEvent) => {
      if (!holdsAlone(event, mod)) set(false)
    }
    const onBlur = () => set(false)
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("keyup", onKey, true)
    window.addEventListener("pointermove", onPointer, true)
    window.addEventListener("blur", onBlur)
    return () => {
      set(false)
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("keyup", onKey, true)
      window.removeEventListener("pointermove", onPointer, true)
      window.removeEventListener("blur", onBlur)
    }
  }, [alt, ctrl, sup])
}
