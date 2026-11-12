import type { Enter, TurnView } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { Spinner } from "@banda/ui/components/spinner"
import { useNow } from "@banda/ui/hooks/use-now"
import { cn } from "@banda/ui/lib/utils"
import {
  ArrowUpIcon,
  ClockIcon,
  CornerUpRightIcon,
  ListPlusIcon,
  SquareIcon,
} from "lucide-react"
import { keyFor, steers } from "./enter-key"

/**
 * The composer's primary button: Stop while the Agent works and nothing is
 * written; else Send, which steers or queues while a turn runs, as Enter
 * does, and Ctrl+click the other (ADR 0010, decision 7); Send when back
 * while the message would wait for its machine (ADR 0105, Q2). It sends
 * nothing itself: it says `onSend`, with whether it goes into the turn.
 */
export function SendButton({
  name,
  enter,
  steering,
  working,
  written,
  ready,
  busy,
  held,
  whenBack,
  onStop,
  onSend,
}: {
  /** The Agent's name, for the tooltip. */
  name: string
  enter: Enter
  /** A turn runs, so a message can go into it. */
  steering: boolean
  /** The turn Stop stops. */
  working: TurnView | undefined
  written: boolean
  /** Whether a message may go now. */
  ready: boolean
  busy: boolean
  /** Why Send waits, its tooltip. */
  held?: string
  /** Send when back's tooltip at a time, while the message would wait. */
  whenBack?: (now: number) => string
  onStop: (turn: TurnView) => void
  /** Sends the message, into the turn if `steer`. */
  onSend: (steer: boolean) => void
}) {
  if (working && !written)
    return (
      <Button
        size="icon-sm"
        className="ml-1 rounded-full"
        aria-label="Stop"
        onClick={() => onStop(working)}
      >
        <SquareIcon className="size-2.5 fill-current" />
      </Button>
    )
  if (whenBack !== undefined)
    return <SendWhenBack title={whenBack} disabled={!ready} busy={busy} />
  const look =
    PRIMARY[!steering ? "send" : steers(enter, false) ? "steer" : "queue"]
  return (
    <Button
      type="submit"
      size="icon-sm"
      // With nothing to send it is not faded but quiet (ADR 0031).
      // Held, it still takes the pointer, so its tooltip says why.
      className={cn(
        "ml-1 rounded-full hover:bg-primary/90 disabled:bg-foreground/10 disabled:text-muted-foreground disabled:opacity-100",
        held !== undefined && "disabled:pointer-events-auto"
      )}
      aria-label={look.label}
      title={held ?? look.title?.(name, enter)}
      disabled={!ready}
      onClick={(event) => {
        // Ctrl (⌘ on a Mac) does the other thing, as with Enter.
        event.preventDefault()
        onSend(steers(enter, event.ctrlKey || event.metaKey))
      }}
    >
      {busy ? <Spinner /> : look.icon}
    </Button>
  )
}

/** Send while the message would wait for its machine (ADR 0105, Q2),
 * its tooltip saying until when, drawn again each second so it says the
 * time it would. Quiet with nothing to send, as Send is, it still takes
 * the pointer, so its tooltip shows. */
function SendWhenBack({
  title,
  disabled,
  busy,
}: {
  title: (now: number) => string
  disabled: boolean
  busy: boolean
}) {
  const now = useNow(1_000)
  return (
    <Button
      type="submit"
      size="sm"
      className="ml-1 gap-1.5 rounded-full pr-3 pl-2.5 text-meta font-medium hover:bg-primary/90 disabled:pointer-events-auto disabled:bg-foreground/10 disabled:text-muted-foreground disabled:opacity-100"
      title={title(now)}
      disabled={disabled}
    >
      {busy ? <Spinner /> : <ClockIcon />}
      Send when back
    </Button>
  )
}

/** What the primary button does with a message, and says so. */
const PRIMARY: Record<
  "send" | Enter,
  {
    label: string
    icon: React.ReactNode
    title?: (name: string, enter: Enter) => string
  }
> = {
  send: { label: "Send", icon: <ArrowUpIcon /> },
  steer: {
    label: "Steer",
    icon: <CornerUpRightIcon />,
    title: (name, enter) =>
      `Steer: ${name} reads it as it works. ${keyFor(enter, "queue")} or Ctrl+click queues it.`,
  },
  queue: {
    label: "Queue",
    icon: <ListPlusIcon />,
    title: (name, enter) =>
      `Queue it: it goes once ${name} is done. ${keyFor(enter, "steer")} or Ctrl+click sends it now.`,
  },
}
