/**
 * Times a Strip's Group plates (ADR 0065, decision 6). A Group at work
 * moves on the page's clock from its start, so every piece of every Group
 * at work breathes, or sweeps, as one, however late each came. A call,
 * done and failed play from when their state came (`arrivals`): a swell
 * for a change seen here, none for a plate first drawn in its state, and
 * none again for a piece the DOM moved, which starts its CSS anew.
 *
 * With `[groups] working = "sheen"` each piece says where it stands in
 * its Group, so the band is one across the Group's pieces.
 */
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react"
import type { GroupState } from "./groups"
import { arrivals, LONG_AGO, type Seen, spans } from "./plates"

export function usePlates(
  scroller: RefObject<HTMLElement | null>,
  states: ReadonlyMap<string, GroupState | undefined>,
  sheen: boolean
): void {
  const seen = useRef(new Map<string, Seen>())
  const sized = useRef<ResizeObserver>(undefined)
  useLayoutEffect(() => {
    const now = document.timeline.currentTime
    seen.current = arrivals(
      seen.current,
      states,
      typeof now === "number" ? now : 0
    )
    const strip = scroller.current
    if (!strip) return
    const plates = [
      ...strip.querySelectorAll<HTMLElement>("[data-group-plate]"),
    ]
    for (const plate of plates) {
      const came = seen.current.get(plate.dataset.groupPlate ?? "")
      const at = came?.state === "working" ? 0 : (came?.at ?? LONG_AGO)
      for (const animation of plate.getAnimations?.() ?? []) {
        // Its colour's crossfade runs from the change, as CSS has it.
        if (animation instanceof CSSAnimation && animation.startTime !== at) {
          animation.startTime = at
        }
      }
    }
    // Each piece's width changes as its column grows or shrinks, with no
    // drawing of the Strip's: the observer places the pieces again.
    sized.current?.disconnect()
    if (!sheen) return
    sized.current ??= new ResizeObserver(() => place(strip))
    for (const plate of plates) sized.current.observe(plate)
  })
  useEffect(() => () => sized.current?.disconnect(), [])
}

/** Says each piece's place in its Group, and the Group's width. */
function place(strip: HTMLElement) {
  const plates = [...strip.querySelectorAll<HTMLElement>("[data-group-plate]")]
  const placed = spans(
    plates.map((plate) => ({
      first: plate.hasAttribute("data-first"),
      width: plate.offsetWidth,
    }))
  )
  plates.forEach((plate, i) => {
    plate.style.setProperty("--group-x", `${placed[i]!.x}px`)
    plate.style.setProperty("--group-span", `${placed[i]!.span}px`)
  })
}
