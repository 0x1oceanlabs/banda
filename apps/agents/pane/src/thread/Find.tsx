import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Button } from "@banda/ui/components/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@banda/ui/components/input-group"
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react"

/** The names the window's CSS marks found words by. */
const FOUND = "find"
const CURRENT = "find-current"

/** The `at`th of `count`, counted round either way. */
function round(at: number, count: number): number {
  return count === 0 ? 0 : ((at % count) + count) % count
}

/** Where `query` shows as text under `root`, in any case, in order. Words
 * only a screen reader hears, and the find bar's own, are not found. */
function rangesOf(root: HTMLElement, query: string): Range[] {
  const wanted = query.toLocaleLowerCase()
  const ranges: Range[] = []
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node instanceof Element && node.matches(".sr-only, [data-find-skip]")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    }
  )
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== Node.TEXT_NODE) continue
    const text = node.textContent?.toLocaleLowerCase() ?? ""
    for (
      let at = text.indexOf(wanted);
      at >= 0;
      at = text.indexOf(wanted, at + wanted.length)
    ) {
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + wanted.length)
      ranges.push(range)
    }
  }
  return ranges
}

/** Scrolls the scroller around `range` so it shows, a third down. */
function reveal(root: HTMLElement, range: Range) {
  const view = root.querySelector<HTMLElement>(
    "[data-slot=message-scroller-viewport]"
  )
  if (!view) return
  const box = view.getBoundingClientRect()
  const found = range.getBoundingClientRect()
  if (found.top >= box.top && found.bottom <= box.bottom) return
  view.scrollTo({ top: view.scrollTop + found.top - box.top - box.height / 3 })
}

function unmark() {
  CSS.highlights.delete(FOUND)
  CSS.highlights.delete(CURRENT)
}

/** How many times the words show, and which is the one found now. */
export type Found = { count: number; current: number }

/**
 * Marks where `query` shows under `root`, the `at`th of them, counted
 * round, as the one found now, which it scrolls to. Marked again as the
 * Thread changes (`version`), once a frame at most.
 */
export function useFound(
  root: React.RefObject<HTMLElement | null>,
  query: string,
  at: number,
  version: unknown
): Found {
  // How many it found comes from the page, not from React: a store it
  // keeps.
  const [counted] = useState(countStore)
  const shown = useRef<string>(undefined)
  useEffect(() => {
    const element = root.current
    if (!element || !query) {
      counted.set(0)
      shown.current = undefined
      return unmark()
    }
    const frame = requestAnimationFrame(() => {
      const ranges = rangesOf(element, query)
      counted.set(ranges.length)
      CSS.highlights.set(FOUND, new Highlight(...ranges))
      if (ranges.length === 0) return CSS.highlights.delete(CURRENT)
      const current = ranges[round(at, ranges.length)]
      CSS.highlights.set(CURRENT, new Highlight(current))
      // It scrolls when the Person looks for something new, not as the
      // Thread grows.
      const looking = `${query}\n${at}`
      if (shown.current !== looking) reveal(element, current)
      shown.current = looking
    })
    return () => cancelAnimationFrame(frame)
  }, [counted, root, query, at, version])
  useEffect(() => unmark, [])
  const count = useSyncExternalStore(counted.listen, counted.get)
  return { count, current: round(at, count) }
}

function countStore() {
  let count = 0
  const heard = new Set<() => void>()
  return {
    get: () => count,
    set: (next: number) => {
      if (next === count) return
      count = next
      heard.forEach((hear) => hear())
    },
    listen: (hear: () => void) => {
      heard.add(hear)
      return () => void heard.delete(hear)
    },
  }
}

/**
 * Find in the Thread, on top of it as T3 Code's: the words, how many
 * show and which is the one found now, Previous and Next. Enter goes on,
 * Shift+Enter back, Escape closes it. It floats as the chat's popups do
 * (ADR 0058): a block's corner, the popover's fill, a hairline ring and
 * one shadow, with no field's frame inside it.
 */
export function FindBar({
  field,
  query,
  found: { count, current },
  onQuery,
  onStep,
  onClose,
}: {
  field: React.RefObject<HTMLInputElement | null>
  query: string
  found: Found
  onQuery: (query: string) => void
  onStep: (by: 1 | -1) => void
  onClose: () => void
}) {
  return (
    <div
      data-find-skip
      className="absolute top-2 right-4 z-10 w-72 max-w-[calc(100%-2rem)] rounded-card bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      <InputGroup className="h-9 border-transparent bg-transparent has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:bg-transparent">
        <InputGroupInput
          ref={field}
          value={query}
          autoFocus
          placeholder="Find in thread"
          aria-label="Find in thread"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // Its own: not the drawer's, nor anything around it.
              event.stopPropagation()
              onClose()
            }
            if (event.key === "Enter") {
              event.preventDefault()
              onStep(event.shiftKey ? -1 : 1)
            }
          }}
        />
        <InputGroupAddon align="inline-end" className="gap-0.5">
          <span
            aria-live="polite"
            className="px-1 text-xs font-normal tabular-nums"
          >
            {!query
              ? ""
              : count === 0
                ? "No results"
                : `${current + 1} of ${count}`}
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Previous match"
            disabled={count === 0}
            onClick={() => onStep(-1)}
          >
            <ChevronUpIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Next match"
            disabled={count === 0}
            onClick={() => onStep(1)}
          >
            <ChevronDownIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Close find"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
