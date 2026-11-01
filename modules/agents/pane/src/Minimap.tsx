import { useMessageScroller } from "@banda/ui/components/message-scroller"

/** From this many messages a Thread is long enough for a minimap. */
const FROM = 3
/** How much of a message its mark says. */
const SAYS = 80

/**
 * A minimap of what the Person sent, as T3 Code's (ADR 0010, decision
 * 9): a mark for each message down the Thread's edge, which names it and
 * goes to it. Inside the Thread's message scroller.
 */
export function Minimap({
  messages,
}: {
  messages: { id: string; text: string }[]
}) {
  const { scrollToMessage } = useMessageScroller()
  if (messages.length < FROM) return null
  return (
    <nav
      aria-label="Your messages"
      className="absolute top-1/2 right-3 z-10 flex h-[min(60%,calc(var(--marks)*0.75rem))] -translate-y-1/2 flex-col"
      style={{ "--marks": messages.length } as React.CSSProperties}
    >
      {messages.map(({ id, text }) => {
        const said = text.length > SAYS ? `${text.slice(0, SAYS)}…` : text
        return (
          <button
            key={id}
            type="button"
            aria-label={said}
            title={said}
            className="group/mark flex min-h-0.5 flex-1 items-center justify-end outline-none"
            onClick={() =>
              scrollToMessage(id, { align: "start", behavior: "smooth" })
            }
          >
            <span className="h-0.5 w-2.5 rounded-full bg-muted-foreground/40 transition-all group-hover/mark:w-4 group-hover/mark:bg-foreground group-focus-visible/mark:w-4 group-focus-visible/mark:bg-ring" />
          </button>
        )
      })}
    </nav>
  )
}
