import { useEffect, useRef, useState } from "react"
import type { TurnView, Usage } from "@bandaso/contract/agents"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@bandaso/ui/components/input-group"
import { RingMeter } from "@bandaso/ui/components/ring-meter"
import { Spinner } from "@bandaso/ui/components/spinner"
import {
  ArrowUpIcon,
  ImagePlusIcon,
  ListPlusIcon,
  SquareIcon,
} from "lucide-react"
import { AttachmentList, type Attached, type Attachments } from "./Attachments"
import { imagesAmong, KINDS } from "./images"
import { ownCommand, type Suggested } from "./slash"
import { useSlashMenu } from "./SlashMenu"

/**
 * Where a Person writes to the Agent: the text, with the slash commands
 * it can start with; the images it carries, added with the button or by
 * pasting them; and Send, or Stop while the Agent works and nothing is
 * written. While the Agent works, a message goes into its turn (Enter, as
 * T3 Code's default) or waits for the turn to end (Queue, Ctrl+Enter).
 */
export function Composer({
  name,
  focused,
  busy,
  working,
  steering,
  usage,
  commands,
  images,
  dropping,
  onPlanMode,
  onSend,
  onStop,
  children,
}: {
  name: string
  focused: boolean
  busy: boolean
  /** The turn Stop stops: the one that runs, or the next. */
  working: TurnView | undefined
  /** A turn runs, so a message can go into it. */
  steering: boolean
  /** How full the Agent's context is, once its Harness has said. */
  usage?: Usage
  /** The slash commands a message can start with, suggested as it is
   * typed. */
  commands: Suggested[]
  /** The images the message carries. */
  images: Attachments
  /** Images are dragged over the Pane, to drop them here. */
  dropping: boolean
  /** Switches the Thread's plan mode, for `/plan` and `/default`. */
  onPlanMode: (on: boolean) => void
  /** Sends the text and the images, into the turn that runs if `steer`;
   * resolves whether it went. */
  onSend: (text: string, images: Attached[], steer: boolean) => Promise<boolean>
  onStop: (turn: TurnView) => void
  /** What the Thread runs with, beside the send button. */
  children?: React.ReactNode
}) {
  const [text, setText] = useState("")
  const field = useRef<HTMLTextAreaElement>(null)
  const files = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focused) field.current?.focus()
  }, [focused])

  const pick = (command: Suggested) => {
    if (command.planMode === undefined) {
      setText(`/${command.name} `)
    } else {
      onPlanMode(command.planMode)
      setText("")
    }
  }
  const slash = useSlashMenu({ text, commands, name, onPick: pick })

  const written = text.trim() !== "" || images.adding.length > 0
  const ready = written && !busy && !images.busy
  const send = async (steer: boolean) => {
    if (!ready) return
    // A message that is only `/plan` or `/default` switches plan mode.
    const own = images.adding.length === 0 && ownCommand(text, commands)
    if (own) {
      pick(own)
      return
    }
    const sending = images.attached
    if (await onSend(text, sending, steer && steering)) {
      setText("")
      images.sent(sending)
    }
  }

  return (
    <form
      className="relative flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        void send(true)
      }}
    >
      {images.problem && (
        <p role="alert" className="px-1 text-xs text-destructive">
          {images.problem}
        </p>
      )}
      {slash.menu}
      <input
        ref={files}
        type="file"
        accept={KINDS.join(",")}
        multiple
        hidden
        aria-label="Images to add"
        onChange={(event) => {
          images.add([...(event.target.files ?? [])])
          event.target.value = ""
        }}
      />
      <InputGroup
        data-dropping={dropping || undefined}
        className="data-dropping:border-ring data-dropping:ring-3 data-dropping:ring-ring/50"
      >
        {images.adding.length > 0 && (
          <InputGroupAddon align="block-start">
            <AttachmentList adding={images.adding} onRemove={images.remove} />
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={field}
          value={text}
          rows={1}
          placeholder={`Write to ${name}`}
          aria-label={`Message to ${name}`}
          {...slash.field}
          className="max-h-48 min-h-10"
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            const pasted = imagesAmong(event.clipboardData.files)
            if (pasted.length === 0) return
            event.preventDefault()
            images.add(pasted)
          }}
          onKeyDown={(event) => {
            if (slash.onKeyDown(event)) return
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              // Ctrl (⌘ on a Mac) does the other thing: it queues.
              void send(!(event.ctrlKey || event.metaKey))
            }
          }}
        />
        <InputGroupAddon align="block-end" className="justify-between gap-2">
          {!images.closed && (
            <InputGroupButton
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Add images"
              title="Add images"
              onClick={() => files.current?.click()}
            >
              <ImagePlusIcon />
            </InputGroupButton>
          )}
          <div className="min-w-0 flex-1">{children}</div>
          {usage && <ContextUsed usage={usage} />}
          {working && !written ? (
            <InputGroupButton
              type="button"
              variant="secondary"
              size="icon-sm"
              aria-label="Stop"
              onClick={() => onStop(working)}
            >
              <SquareIcon className="fill-current" />
            </InputGroupButton>
          ) : (
            <>
              {steering && (
                <InputGroupButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Queue"
                  title={`Queue it: it goes once ${name} is done (Ctrl+Enter).`}
                  disabled={!ready}
                  onClick={() => void send(false)}
                >
                  <ListPlusIcon />
                </InputGroupButton>
              )}
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                aria-label={steering ? "Send now" : "Send"}
                title={
                  steering
                    ? `Send it now: ${name} reads it as it works (Enter).`
                    : undefined
                }
                disabled={!ready}
              >
                {busy ? <Spinner /> : <ArrowUpIcon />}
              </InputGroupButton>
            </>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}

/** From this share of its context used, an Agent is near the point where
 * its Harness compacts or stops: the share shows as a warning. */
const NEARLY_FULL = 80

/** How full the Agent's context is: a ring, and the share; what it cost
 * so far on hover, when the Harness says. */
function ContextUsed({ usage: { used, size, cost } }: { usage: Usage }) {
  const share = size > 0 ? Math.round((used / size) * 100) : 0
  const tokens = new Intl.NumberFormat("en", { notation: "compact" })
  const spent =
    cost &&
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: cost.currency,
    }).format(cost.amount)
  const words =
    `${share}% of the context used: ${tokens.format(used)} of ${tokens.format(size)} tokens` +
    (spent ? `. ${spent} so far.` : ".")
  return (
    <span
      title={words}
      data-full={share >= NEARLY_FULL || undefined}
      className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums data-full:text-destructive"
    >
      <RingMeter
        value={share}
        aria-label="Context used"
        getAriaValueText={() => words}
      />
      {share}%
    </span>
  )
}
