/**
 * What a long view draws only near where it is scrolled to: whether an
 * element is near what its list shows, one watch per list for all its
 * parts, and an element's width as it changes.
 */
import { useEffect, useState } from "react"

/** Whether `element` is within `margin` of what `root` shows. */
export function useNear(
  element: React.RefObject<Element | null>,
  root: React.RefObject<Element | null>,
  margin: string
): boolean {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const target = element.current
    if (!target || !root.current) return
    return watchNear(root.current, margin, target, setNear)
  }, [element, root, margin])
  return near
}

/** One watch per list and margin, for all its pages: a list of a
 * thousand pages watches once. */
const WATCHES = new WeakMap<
  Element,
  Map<string, { watch: IntersectionObserver; heard: Map<Element, Hear> }>
>()
type Hear = (near: boolean) => void

/** Tells `hear` whether `target` is within `margin` of what `root`
 * shows, as it changes; returns how to stop. */
function watchNear(
  root: Element,
  margin: string,
  target: Element,
  hear: Hear
): () => void {
  let byMargin = WATCHES.get(root)
  if (!byMargin) WATCHES.set(root, (byMargin = new Map()))
  let one = byMargin.get(margin)
  if (!one) {
    const heard = new Map<Element, Hear>()
    const watch = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          heard.get(entry.target)?.(entry.isIntersecting)
      },
      { root, rootMargin: margin }
    )
    byMargin.set(margin, (one = { watch, heard }))
  }
  const { watch, heard } = one
  heard.set(target, hear)
  watch.observe(target)
  return () => {
    heard.delete(target)
    watch.unobserve(target)
  }
}

/** `element`'s width, as it changes. */
export function useWidth(element: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const target = element.current
    if (!target) return
    // It says the width once as it starts to watch, and as it changes.
    const watch = new ResizeObserver(() => setWidth(target.clientWidth))
    watch.observe(target)
    return () => watch.disconnect()
  }, [element])
  return width
}
