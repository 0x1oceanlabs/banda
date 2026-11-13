// The living Mark, taken from the design kit as it is
// (docs/design/kit/mark.js). Loading it sets `window.BandaMark` and
// mounts every `[data-mark]` already on the page.
import "../../../docs/design/kit/mark.js"

export type MarkState =
  | "asks"
  | "failed"
  | "done"
  | "woke"
  | "open"
  | "later"
  | "offline"
  | "working"
  | "rest"

export interface MarkOptions {
  state?: MarkState
  doing?: string
  satellites?: number | MarkState[]
  size?: number
  logo?: boolean
  calls?: boolean
  still?: boolean
  news?: boolean
}

export interface MarkHandle {
  set(options: MarkOptions): MarkHandle
  destroy(): void
  svg: SVGSVGElement
}

interface Kit {
  mount(target: Element, options: MarkOptions): MarkHandle
  quiet: boolean
}

declare global {
  interface Window {
    BandaMark: Kit
  }
}

export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches

const kit = window.BandaMark
// Reduced motion stills every Mark, the calls too.
if (reduced) kit.quiet = true

/** The Mark the kit mounted on this element from its `data-mark`. */
export function markOf(element: Element | null): MarkHandle | undefined {
  return (element as (Element & { __bandaMark?: MarkHandle }) | null)
    ?.__bandaMark
}

/** Stills the Marks under `root` while it is off screen: the kit draws
 * every Mark on every frame, seen or not. */
export function stillOffscreen(root: Element) {
  if (reduced) return
  new IntersectionObserver(
    ([entry]) => {
      root.querySelectorAll("[data-mark]").forEach((node) => {
        markOf(node)?.set({ still: !entry.isIntersecting })
      })
    },
    { rootMargin: "120px" }
  ).observe(root)
}

/** Runs `start` while `root` is on screen and `stop` once it leaves:
 * a loop nobody sees costs the reader's battery. */
export function whileVisible(
  root: Element,
  start: () => void,
  stop: () => void
) {
  let on = false
  new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting === on) return
      on = entry.isIntersecting
      if (on) start()
      else stop()
    },
    { rootMargin: "80px" }
  ).observe(root)
}
