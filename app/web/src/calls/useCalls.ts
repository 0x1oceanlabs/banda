import { useCallback, useEffect, useRef } from "react"
import type { Call } from "@bandaso/ui/pane"
import { type Chime, player, type SoundSettings } from "@bandaso/ui/sound"
import { GATHER, loudestChime, type Played, plays } from "./calls"

/**
 * What the window does with the modules' calls: it gathers them for a
 * moment and plays the loudest, as `settings` say. The function it gives
 * stays the same, so a Watch can keep it.
 */
export function useCalls(settings: SoundSettings): (call: Call) => void {
  const current = useRef(settings)
  useEffect(() => {
    current.current = settings
  }, [settings])
  const gathered = useRef<Chime[]>([])
  const last = useRef<Played | undefined>(undefined)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])

  return useCallback((call: Call) => {
    gathered.current.push(call.chime)
    if (timer.current) return
    timer.current = window.setTimeout(() => {
      timer.current = 0
      const chime = loudestChime(gathered.current)
      gathered.current = []
      const now = performance.now()
      if (!chime || !plays(last.current, chime, now)) return
      last.current = { chime, at: now }
      player.play(chime, current.current)
    }, GATHER)
  }, [])
}
