import type { ReactNode } from "react"
import { createPortal } from "react-dom"

/**
 * Draws `children` in the window's top layer, over every workspace and
 * the pages the browser keeps over them, as menus are drawn.
 */
function TopLayer({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}

/**
 * Draws `children` in `element`, which a module keeps out of React's
 * tree: over a browser page, in the layer the pages live in.
 */
function DrawnIn({
  element,
  children,
}: {
  element: Element
  children: ReactNode
}) {
  return createPortal(children, element)
}

export { DrawnIn, TopLayer }
