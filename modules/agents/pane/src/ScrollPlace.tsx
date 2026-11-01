import { useLayoutEffect } from "react"
import { useMessageScroller } from "@banda/ui/components/message-scroller"

/** The Threads whose place it remembers, the latest left last. */
const KEEP = 50
/** Each Thread's place, by the message at the top of its Pane, while the
 * window lives; none for a Thread left at its end. */
const places = new Map<string, string>()
/** Closer to the end than this, in px, a Thread is at its end. */
const AT_END = 8

function keep(thread: string, message: string | undefined) {
  places.delete(thread)
  if (message === undefined) return
  places.set(thread, message)
  if (places.size > KEEP) places.delete(places.keys().next().value!)
}

/** The message at the top of `view`, once its Person scrolled up from the
 * end. */
function topOf(view: HTMLElement): string | undefined {
  const { scrollHeight, scrollTop, clientHeight } = view
  if (scrollHeight - scrollTop - clientHeight <= AT_END) return undefined
  const top = view.getBoundingClientRect().top
  for (const item of view.querySelectorAll<HTMLElement>("[data-message-id]"))
    if (item.getBoundingClientRect().bottom > top) return item.dataset.messageId
  return undefined
}

/**
 * Keeps where a Person left `thread`, and takes them back there when it
 * opens again, as T3 Code does (ADR 0010, decision 8). Inside the
 * Thread's message scroller, whose viewport is `viewport`; it shows
 * nothing, and measures only as the Thread goes.
 */
export function ScrollPlace({
  thread,
  viewport,
}: {
  thread: string
  viewport: React.RefObject<HTMLDivElement | null>
}) {
  const { scrollToMessage } = useMessageScroller()
  useLayoutEffect(() => {
    const kept = places.get(thread)
    if (kept) scrollToMessage(kept, { align: "start" })
    // Its ref is gone by the time this cleans up; the element is not.
    const view = viewport.current
    return () => keep(thread, view ? topOf(view) : undefined)
  }, [thread, scrollToMessage, viewport])
  return null
}
