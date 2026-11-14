import { useEffect, useState } from "react"
import { MINUTE } from "../lib/words"

/** The time now, in milliseconds, again every `every` ms while `ticking`. */
export function useNow(every: number, ticking = true): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(timer)
  }, [every, ticking])
  return now
}

/** What hears each minute begin, and the one timer that tells them. */
const minuteHeard = new Set<(now: number) => void>()
let minuteTimer: ReturnType<typeof setTimeout> | undefined

function nextMinute() {
  const now = Date.now()
  minuteTimer = setTimeout(nextMinute, MINUTE - (now % MINUTE))
  for (const hear of minuteHeard) hear(now)
}

/** The time now, again as each minute begins, so what is worked out
 * against it in minutes, such as a list of clock times or a sidebar
 * card's "14m", changes on the minute and not up to one late. One timer
 * ticks for every part that asks, while any does. */
export function useMinute(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    minuteHeard.add(setNow)
    if (minuteTimer === undefined)
      minuteTimer = setTimeout(nextMinute, MINUTE - (Date.now() % MINUTE))
    return () => {
      minuteHeard.delete(setNow)
      if (minuteHeard.size > 0) return
      clearTimeout(minuteTimer)
      minuteTimer = undefined
    }
  }, [])
  return now
}
