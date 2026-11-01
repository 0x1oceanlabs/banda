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
  CornerUpRightIcon,
  ImagePlusIcon,
  ListPlusIcon,
  SquareIcon,
} from "lucide-react"
import { AttachmentList, type Attached, type Attachments } from "./Attachments"
import { useDraft } from "./drafts"
import { type EnterKey, keyFor, steers, useEnterKey } from "./enter-key"
import { recall } from "./history"
import { imagesAmong, KINDS } from "./images"
import { ownCommand, type Suggested } from "./slash"
import { type FindFiles, useFileMenu } from "./FileMenu"
import { mention, mentioning } from "./mention"
import { useSlashMenu } from "./SlashMenu"

/**
 * Where a Person writes to the Agent: the text, with the slash commands
 * it can start with; the images it carries, added with the button or by
 * pasting them; and Send, or Stop while the Agent works and nothing is
 * written. While the Agent works, a message goes into its turn or waits
 * for the turn to end: Enter and the button do what the window chose,
 * into the turn as T3 Code's default, and Ctrl+Enter or Ctrl+click the
 * other. As in T3 Code, ↑ and ↓ in an empty box walk the earlier
 * messages, after the last one that waits, which ↑ opens to edit; and
 * what is written waits as the Thread's draft.
 */
export function Composer({
  name,
  thread,
  history,
  placeholder,
  plan,
  focused,
  busy,
  working,
  steering,
  usage,
  commands,
  images,
  dropping,
  onPlanMode,
  findFiles,
  onEditLast,
  onSend,
  onStop,
  children,
}: {
  name: string
  /** The Thread it writes to, which keeps its draft; null before it
   * starts. */
  thread: string | null
  /** What the Person sent the Thread before, oldest first, read when ↑
   * or ↓ asks. */
  history: () => readonly string[]

  /** What the empty box says, instead of asking to write to `name`. */
  placeholder?: string
  /** Whether plan mode is on, where the Harness has one: Shift+Tab
   * switches it. */
  plan?: boolean
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
  /** Finds files in the Space's folder, for `@`. */
  findFiles?: FindFiles
  /** Opens the last message that waits to edit; given while one does. */
  onEditLast?: () => void
  /** Sends the text and the images, into the turn that runs if `steer`;
   * resolves whether it went. */
  onSend: (text: string, images: Attached[], steer: boolean) => Promise<boolean>
  onStop: (turn: TurnView) => void
  /** What the Thread runs with, beside the send button. */
  children?: React.ReactNode
}) {
  const [text, setText] = useDraft(thread)
  // How far back ↑ has walked the history; 0 for not at all.
  const [back, setBack] = useState(0)
  const [enter] = useEnterKey()
  const field = useRef<HTMLTextAreaElement>(null)
  const files = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focused) field.current?.focus()
  }, [focused])

  // Where the caret is, for `@` and a file's name before it.
  const [caret, setCaret] = useState(0)
  /** Puts `next` in the box, the caret at its end, where the field puts it. */
  const put = (next: string) => {
    setText(next)
    setCaret(next.length)
  }
  const pick = (command: Suggested) => {
    if (command.planMode === undefined) {
      put(`/${command.name} `)
    } else {
      onPlanMode(command.planMode)
      put("")
    }
  }
  const slash = useSlashMenu({ text, commands, name, onPick: pick })
  const at = mentioning(text, caret)
  const fileMenu = useFileMenu({
    text,
    word: at?.word,
    findFiles,
    onPick: (path) => {
      if (!at) return
      const named = mention(text, at, path)
      setText(named.text)
      setCaret(named.caret)
      requestAnimationFrame(() =>
        field.current?.setSelectionRange(named.caret, named.caret)
      )
    },
  })

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
      // What the Person wrote while it went stays.
      setText((now) => (now === text ? "" : now))
      setBack(0)
      images.sent(sending)
    }
  }

  const look =
    PRIMARY[!steering ? "send" : steers(enter, false) ? "steer" : "queue"]
  return (
    <form
      className="relative flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        void send(steers(enter, false))
      }}
    >
      {images.problem && (
        <p role="alert" className="px-1 text-xs text-destructive">
          {images.problem}
        </p>
      )}
      {slash.menu}
      {fileMenu.menu}
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
          placeholder={placeholder ?? `Write to ${name}`}
          aria-label={`Message to ${name}`}
          {...slash.field}
          {...fileMenu.field}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          className="max-h-48 min-h-10"
          onChange={(event) => {
            setText(event.target.value)
            setCaret(event.target.selectionStart)
            setBack(0)
          }}
          onPaste={(event) => {
            const pasted = imagesAmong(event.clipboardData.files)
            if (pasted.length === 0) return
            event.preventDefault()
            images.add(pasted)
          }}
          onKeyDown={(event) => {
            if (slash.onKeyDown(event) || fileMenu.onKeyDown(event)) return
            if (event.key === "Tab" && event.shiftKey && plan !== undefined) {
              event.preventDefault()
              onPlanMode(!plan)
              return
            }
            const up = event.key === "ArrowUp"
            if (plain(event) && (up || event.key === "ArrowDown")) {
              // Within a message of more lines, the caret moves first.
              if (!atEdge(event.currentTarget, up)) return
              const waits = onEditLast !== undefined
              const step = recall(history(), back, text, up, waits)
              if (!step) return
              event.preventDefault()
              if (step === "edit") return onEditLast?.()
              put(step.text)
              setBack(step.back)
              return
            }
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              // Ctrl (⌘ on a Mac) does the other thing.
              void send(steers(enter, event.ctrlKey || event.metaKey))
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
          {/* What the Thread runs with rests, faded, while the box is not
              in use. */}
          <div className="min-w-0 flex-1 opacity-60 transition-opacity group-focus-within/input-group:opacity-100 group-hover/input-group:opacity-100">
            {children}
          </div>
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
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              aria-label={look.label}
              title={look.title?.(name, enter)}
              disabled={!ready}
              onClick={(event) => {
                // Ctrl (⌘ on a Mac) does the other thing, as with Enter.
                event.preventDefault()
                void send(steers(enter, event.ctrlKey || event.metaKey))
              }}
            >
              {busy ? <Spinner /> : look.icon}
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}

/** What the primary button does with a message, and says so. */
const PRIMARY: Record<
  "send" | EnterKey,
  {
    label: string
    icon: React.ReactNode
    title?: (name: string, enter: EnterKey) => string
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

/** Whether a key comes with no modifier held. */
function plain(event: React.KeyboardEvent): boolean {
  return !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey
}

/** Whether the caret is on the first line of `field`, going `up`, or on
 * its last. */
function atEdge(field: HTMLTextAreaElement, up: boolean): boolean {
  const { value, selectionStart, selectionEnd } = field
  return up
    ? value.lastIndexOf("\n", selectionStart - 1) < 0
    : value.indexOf("\n", selectionEnd) < 0
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
