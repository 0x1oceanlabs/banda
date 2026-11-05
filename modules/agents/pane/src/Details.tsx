/**
 * Thread details (ADR 0034, decision 4): the card of rows the modules
 * give, as T3 Code's. It sits at the Thread's top right when the Thread
 * is wide enough to hold it beside the messages, open until the Person
 * hides it; when narrower, it opens in a popover under its button. The
 * button is in the Thread's header, and Ctrl+Shift+B does the same; a
 * module's key may ask the focused Thread's card to show (`askDetails`).
 */
import { type RefObject, useEffect, useEffectEvent, useState } from "react"
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
  hearAsks,
  showDetails,
  useDetails,
} from "@banda/ui/components/thread-details"
import { useWiderThan } from "@banda/ui/hooks/use-wider-than"
import type { Key } from "@banda/ui/lib/keys"
import { SquareMenuIcon } from "lucide-react"

/** The card's key, Ctrl+Shift+B (⌘⇧B on a Mac), as T3 Code's. */
export const DETAILS_KEY: Key = { code: "KeyB", ctrl: true, shift: true }

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
  focused,
  ...given
}: Omit<DetailsProps, "opening" | "opened"> & {
  /** The Thread's tile has the focus: a key's ask is its. */
  focused: boolean
  wide: boolean
  shown: boolean
  onShown: (shown: boolean) => void
}) {
  const details = useDetails()
  // A key's ask, as Alt+Shift+G's, shows the focused Thread's card and
  // keeps what to open in it till that part is drawn and opened; hidden,
  // the card forgets it.
  const [opening, setOpening] = useState<string | null>(null)
  const [was, setWas] = useState(shown)
  if (was !== shown) {
    setWas(shown)
    if (!shown) setOpening(null)
  }
  const asked = useEffectEvent((id: string) => {
    setOpening(id)
    onShown(true)
  })
  useEffect(() => (focused ? hearAsks(asked) : undefined), [focused])
  // Shown, its rows' Space knows the card says what they do.
  const { space, thread } = given
  useEffect(
    () => (shown ? showDetails(space, thread) : undefined),
    [shown, space, thread]
  )
  if (details.length === 0) return null
  const props: DetailsProps = {
    ...given,
    opening,
    opened: () => setOpening(null),
  }

  const card = (
    <div className="hidden flex-col has-[>section:not(:empty)]:flex">
      {details.map(({ id, Rows }) => (
        <section
          key={id}
          aria-label={id}
          className="flex flex-col gap-0.5 border-t pt-1 first:border-t-0 first:pt-0 empty:hidden [&+section]:mt-1"
        >
          <Rows {...props} />
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
            className="absolute z-10 rounded-xl bg-popover/80 p-1.5 shadow-sm ring-1 ring-foreground/10 backdrop-blur"
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
