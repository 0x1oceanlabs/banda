/**
 * Thread details (ADR 0034, decision 4): the card of rows the modules
 * give, as T3 Code's, Threads' Slot `thread.details`, which it reads here
 * alone. It sits at the Thread's top right when the Thread is wide enough
 * to hold it beside the messages, open until the Person hides it; when
 * narrower, it opens in a popover under its button. The button is in the
 * Thread's header, and Ctrl+Shift+B does the same; a module's key may ask
 * the focused Thread's card to show with a part of its rows open
 * (`agents.thread.details`).
 */
import type { RefObject } from "react"
import { Button } from "@banda/ui/components/button"
import { InHeader } from "@banda/ui/components/pane-header"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import {
  DETAILS_CARD as CARD,
  DETAILS_GAP as GAP,
  DETAILS_WIDE,
  type DetailsProps,
} from "@banda/ui/components/thread-details"
import { useSlot } from "@banda/ui/slots"
import { useWiderThan } from "@banda/ui/hooks/use-wider-than"
import { SquareMenuIcon } from "lucide-react"

/** Whether `pane` is wide enough to hold the card beside the messages,
 * kept current. */
export function useWide(pane: RefObject<HTMLElement | null>): boolean {
  return useWiderThan(pane, DETAILS_WIDE)
}

/** The card and its button: at the top right when `wide`, else in a
 * popover; `shown` as the Thread keeps it. None when no module gives it
 * rows. */
export function ThreadDetails({
  wide,
  shown,
  onShown,
  ...props
}: DetailsProps & {
  wide: boolean
  shown: boolean
  onShown: (shown: boolean) => void
}) {
  const details = useSlot("thread.details")
  if (details.length === 0) return null

  const card = (
    <div className="hidden flex-col has-[>section:not(:empty)]:flex">
      {details.map(({ id, Fill }) => (
        <section
          key={id}
          aria-label={id}
          className="flex flex-col gap-0.5 border-t pt-1 first:border-t-0 first:pt-0 empty:hidden [&+section]:mt-1"
        >
          <Fill {...props} />
        </section>
      ))}
    </div>
  )
  const button = (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Thread details"
      aria-pressed={shown}
      title="Thread details (Ctrl+Shift+B)"
      className="shrink-0 aria-pressed:bg-muted"
      onClick={wide ? () => onShown(!shown) : undefined}
    >
      <SquareMenuIcon />
    </Button>
  )
  if (wide)
    return (
      <>
        <InHeader>{button}</InHeader>
        {shown && (
          <aside
            aria-label="Thread details"
            style={{ width: CARD, top: GAP / 2, right: GAP }}
            className="absolute z-10 rounded-card bg-popover/80 p-1.5 shadow-sm ring-1 ring-foreground/10 backdrop-blur"
          >
            {card}
          </aside>
        )}
      </>
    )
  return (
    <InHeader>
      <Popover open={shown} onOpenChange={onShown}>
        <PopoverTrigger render={button} />
        <PopoverContent
          aria-label="Thread details"
          style={{ width: CARD }}
          className="p-1.5"
        >
          {card}
        </PopoverContent>
      </Popover>
    </InHeader>
  )
}
