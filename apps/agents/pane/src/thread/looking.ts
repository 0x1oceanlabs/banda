/**
 * Whether the Person looks at a Thread, not only passes it (ADR 0096,
 * decision 3): its Pane has the focus and they did something in it, a click
 * or a key, or it kept the focus for `seen-after` seconds in agents.toml. A Pane the focus only
 * passes, as the Strip scrolls by it or `Alt+arrow` goes through it, leaves
 * the Thread's mark as it is.
 */
import { AGENTS_FILE } from "@banda/contract/agents"
import { useFile } from "@banda/ui/lib/look"
import { useCallback, useEffect, useState } from "react"

/**
 * Whether an input in the Thread's Pane is the Person working there: a
 * click, or a key with no mod. A key with the mod is the window's, as
 * `Alt+arrow` moving on, and says nothing of this Thread.
 */
export function actsHere(event: { type: string } & Partial<KeyboardEvent>) {
  if (event.type !== "keydown") return event.type === "pointerdown"
  return !event.altKey && !event.ctrlKey && !event.metaKey
}

/**
 * `looking`, and `acted` for the Pane's pointer and key inputs. A click
 * on a Pane comes before its focus: it counts once the focus follows.
 */
export function useLooking(focused: boolean) {
  // How long the focus rests before it is a look (ADR 0096, decision 3).
  const after = useFile(AGENTS_FILE).seen_after * 1000
  const [looking, setLooking] = useState(false)
  // The focus gone, the look is over: a new focus starts again.
  const [was, setWas] = useState(focused)
  if (was !== focused) {
    setWas(focused)
    if (!focused) setLooking(false)
  }
  useEffect(() => {
    if (!focused) return
    const timer = setTimeout(() => setLooking(true), after)
    return () => clearTimeout(timer)
  }, [focused, after])
  const acted = useCallback(
    (event: { type: string } & Partial<KeyboardEvent>) => {
      if (actsHere(event)) setLooking(true)
    },
    []
  )
  return { looking: focused && looking, acted }
}
