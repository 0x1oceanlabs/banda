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

/** The time now, again as each minute begins, so what is worked out
 * against it in minutes, such as a list of clock times, changes on the
 * minute and not up to one late. */
export function useMinute(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), MINUTE - (now % MINUTE))
    return () => clearTimeout(timer)
  }, [now])
  return now
}
