import type { ReactNode } from "react"
import { createPortal } from "react-dom"

/**
 * Draws `children` in the window's top layer, over every workspace and
 * the pages the browser keeps over them, as menus are drawn.
 */
function TopLayer({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}

export { TopLayer }
