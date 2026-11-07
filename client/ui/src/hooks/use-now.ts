import { useEffect, useState } from "react"

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
