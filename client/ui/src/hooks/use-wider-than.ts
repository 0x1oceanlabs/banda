import { type RefObject, useEffect, useState } from "react"

/**
 * Whether the element `of` is at least `px` wide, kept current as it is
 * resized: a render only when that flips. False till it is measured.
 */
export function useWiderThan(
  of: RefObject<HTMLElement | null>,
  px: number
): boolean {
  const [wider, setWider] = useState(false)
  useEffect(() => {
    const own = of.current
    if (!own) return
    const seen = new ResizeObserver(([entry]) => {
      const now = (entry?.contentRect.width ?? 0) >= px
      setWider((was) => (was === now ? was : now))
    })
    seen.observe(own)
    return () => seen.disconnect()
  }, [of, px])
  return wider
}
