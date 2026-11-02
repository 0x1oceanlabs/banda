import { useEffect, useRef, useState } from "react"
import { Button } from "@banda/ui/components/button"
import { QuoteIcon } from "lucide-react"

/** Where a reply's text is that can be quoted, one reply each: the
 * Agent's messages mark theirs. */
const QUOTABLE = "data-quotable"

/**
 * A button by the text a Person selected in one of the Agent's replies,
 * which quotes it in the composer, as T3 Code's Cite does (ADR 0015,
 * decision 6). It shows once the selection is made, not while the mouse
 * drags it, and goes with it.
 */
export function QuoteSelection({
  area,
  onQuote,
}: {
  /** The box the transcript scrolls in, which the button is placed in. */
  area: React.RefObject<HTMLElement | null>
  onQuote: (text: string) => void
}) {
  const [shown, setShown] = useState<Selected>()
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const box = area.current
    if (!box) return
    let pressing = false
    // Once a frame at most, as a selection and a scroll change often.
    let frame = 0
    const look = () => {
      if (pressing) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setShown(selected(box)))
    }
    const press = (event: PointerEvent) => {
      if (button.current?.contains(event.target as Node)) return
      pressing = true
      setShown(undefined)
    }
    const release = () => {
      if (!pressing) return
      pressing = false
      look()
    }
    document.addEventListener("selectionchange", look)
    box.addEventListener("pointerdown", press)
    document.addEventListener("pointerup", release)
    box.addEventListener("scroll", look, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("selectionchange", look)
      box.removeEventListener("pointerdown", press)
      document.removeEventListener("pointerup", release)
      box.removeEventListener("scroll", look, true)
    }
  }, [area])

  if (!shown) return null
  return (
    <Button
      ref={button}
      variant="secondary"
      size="xs"
      className="absolute z-20 shadow-md"
      style={{ left: shown.x, top: shown.y }}
      // The selection stays while the button is pressed.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        // Let go of the reply's selection before the composer takes its own.
        window.getSelection()?.removeAllRanges()
        setShown(undefined)
        onQuote(shown.text)
      }}
    >
      <QuoteIcon />
      Quote
    </Button>
  )
}

type Selected = { text: string; x: number; y: number }

/** The text selected in one reply in `box`, and where under its end the
 * button goes, inside the box; none for any other selection. */
function selected(box: HTMLElement): Selected | undefined {
  const selection = window.getSelection()
  const text = selection?.toString().trim()
  if (!selection || !text) return undefined
  const range = selection.getRangeAt(0)
  const reply = replyOf(range.startContainer)
  if (!reply || reply !== replyOf(range.endContainer) || !box.contains(reply))
    return undefined
  const lines = range.getClientRects()
  const end = lines[lines.length - 1] ?? range.getBoundingClientRect()
  const bounds = box.getBoundingClientRect()
  if (end.bottom < bounds.top || end.top > bounds.bottom) return undefined
  const MARGIN = 8
  return {
    text,
    x: Math.max(
      MARGIN,
      Math.min(end.right - bounds.left - MARGIN, bounds.width - 96)
    ),
    y: Math.min(end.bottom - bounds.top + 4, bounds.height - 32),
  }
}

function replyOf(node: Node): Element | null | undefined {
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest(`[${QUOTABLE}]`)
}
