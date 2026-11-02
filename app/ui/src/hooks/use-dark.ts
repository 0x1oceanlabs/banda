/** Whether the window is dark now: the `dark` class Banda's look puts on
 * the page's root, followed as it changes. */
import { useSyncExternalStore } from "react"

function subscribe(changed: () => void) {
  const watch = new MutationObserver(changed)
  watch.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
  return () => watch.disconnect()
}

const dark = () => document.documentElement.classList.contains("dark")

export function useDark(): boolean {
  return useSyncExternalStore(subscribe, dark, () => false)
}
