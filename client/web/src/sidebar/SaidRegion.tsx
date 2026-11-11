import { memo, useEffect, useRef } from "react"
import { useLaterClock, useLists } from "../calls/stores"
import { arrivals, SAID, said, type Standing, standingsOf } from "./said"

/**
 * The sidebar's one polite region (spec §2.6), mounted empty with the
 * Window, so it outlives a hidden sidebar and Chromium hears it: `said.ts`
 * writes its line, and it hears each call that comes as the list of
 * every Thread changes.
 */
export const SaidRegion = memo(function SaidRegion() {
  const lists = useLists()
  const now = useLaterClock()
  const before = useRef<ReadonlyMap<string, Standing>>(undefined)
  useEffect(() => {
    const standings = standingsOf(lists, now)
    if (before.current) said.calls(arrivals(before.current, standings))
    before.current = standings
  }, [lists, now])
  return (
    <div
      id={SAID}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    />
  )
})
