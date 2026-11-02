/**
 * Whether `Alt` is held, as Banda's, on the page's root (`data-alt`): a
 * browser's page lets the mouse through then, so `Alt` and the buttons
 * move and size Panes over it too (ADR 0025, decision 5). A page tells
 * the window of its `Alt` as well (@banda/browser-desktop); the pointer
 * moving without it, or the window losing the keys, says it is let go.
 */
import { useEffect } from "react"
import { isAlt } from "@banda/ui/lib/keys"

export function useAltHeld() {
  useEffect(() => {
    const html = document.documentElement
    const set = (held: boolean) => {
      if (held === "alt" in html.dataset) return
      if (held) html.dataset.alt = ""
      else delete html.dataset.alt
    }
    // Alt let go still says it is held on its own key up.
    const onKey = (event: KeyboardEvent) =>
      set(
        event.altKey &&
          !event.ctrlKey &&
          !(event.type === "keyup" && isAlt(event.code))
      )
    const onPointer = (event: PointerEvent) => {
      if (!event.altKey) set(false)
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
  }, [])
}
