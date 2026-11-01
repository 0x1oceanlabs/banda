/**
 * Whether the window is in front: it has the desktop's focus, so the
 * Person can see what it shows (ADR 0011, decision 1). A Pane with the
 * focus in a window behind another one is not looked at.
 */
import { useSyncExternalStore } from "react"

function listen(hear: () => void): () => void {
  window.addEventListener("focus", hear)
  window.addEventListener("blur", hear)
  return () => {
    window.removeEventListener("focus", hear)
    window.removeEventListener("blur", hear)
  }
}

/** Whether the window is in front now. */
export function inFront(): boolean {
  return document.hasFocus()
}

/** Whether the window is in front, kept current. */
export function useInFront(): boolean {
  return useSyncExternalStore(listen, inFront, () => true)
}
