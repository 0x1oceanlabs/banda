import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import type { Image, TurnView, Usage } from "@banda/contract/agents"
import type { Enter } from "@banda/contract/look"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@banda/ui/components/input-group"
import {
  PromptEditor,
  type PromptEditorHandle,
  type Typing,
} from "@banda/ui/components/prompt-editor"
import { RingMeter } from "@banda/ui/components/ring-meter"
import { quoted } from "@banda/ui/lib/prompt"
import { Spinner } from "@banda/ui/components/spinner"
import {
  ArrowUpIcon,
  CornerUpRightIcon,
  ImagePlusIcon,
  ListPlusIcon,
  SquareIcon,
} from "lucide-react"
import { AttachmentList, type Attachments } from "./Attachments"
import { useDraft } from "./drafts"
import { keyFor, steers, useEnterKey } from "./enter-key"
import { recall } from "./history"
import { imagesAmong, KINDS } from "./images"
import { ownCommand, type Suggested } from "./slash"
import { type FindFiles, useFileMenu } from "./FileMenu"
import { useSlashMenu } from "./SlashMenu"
import { stray, typed } from "./stray"

/**
 * Where a Person writes to the Agent: the text, with the slash commands
 * it can start with; the images it carries, added with the button or by
 * pasting them; and Send, or Stop while the Agent works and nothing is
 * written. While the Agent works, a message goes into its turn or waits
 * for the turn to end: Enter and the button do what agents.toml says,
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
  keep,
  onEditLast,
  onSend,
  onStop,
  children,
  ref,
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
  /** Keeps a file in the Space for the message to name; resolves its
   * path, or nothing if it could not be kept. */
  keep: (file: File) => Promise<string | undefined>
  /** Opens the last message that waits to edit; given while one does. */
  onEditLast?: () => void
  /** Sends the text and the images, into the turn that runs if `steer`;
   * resolves whether it went. */
  onSend: (text: string, images: Image[], steer: boolean) => Promise<boolean>
  onStop: (turn: TurnView) => void
  /** What the Thread runs with, beside the send button. */
  children?: React.ReactNode
  ref?: React.Ref<ComposerHandle>
}) {
  const [text, setText] = useDraft(thread)
  // How far back ↑ has walked the history; 0 for not at all.
  const [back, setBack] = useState(0)
  const enter = useEnterKey()
  const field = useRef<PromptEditorHandle>(null)
  const files = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focused) field.current?.focus()
  }, [focused])
  // Files dropped or pasted join the message: images as images, any other
  // kept in the Space and named in the text, in turn, as `@` names a file.
  const take = async (given: File[], at: "caret" | "end") => {
    const pictures = imagesAmong(given)
    if (pictures.length > 0) images.add(pictures)
    for (const file of given) {
      if (pictures.includes(file)) continue
      const path = await keep(file)
      if (path) field.current?.point(path, at)
    }
  }
  useImperativeHandle(ref, () => ({
    take: (given) => void take(given, "end"),
    // A line apart from what is written after it, which would else run on
    // in it.
    quote: (quote) => field.current?.putLines(`${quoted(quote)}\n\n`),
  }))
  // Whether the paste coming is Mod+Shift+V's, which pastes a long text as
  // text: the last key pressed says.
  const asText = useRef(false)
  /** Takes from a paste what is not text for the box: files, and a text
   * too long for it, kept as a file; whether it took any. */
  const takePaste = (event: ClipboardEvent, at: "caret" | "end") => {
    const data = event.clipboardData
    if (!data) return false
    const pasted = data.getData("text/plain")
    if (data.files.length > 0) void take([...data.files], at)
    else if (!asText.current && long(pasted)) {
      const name = `pasted-text-${(text.match(PASTED)?.length ?? 0) + 1}.txt`
      const file = new File([pasted], name, { type: "text/plain" })
      void take([file], at)
    } else return false
    event.preventDefault()
    return true
  }
  const takePasteLater = useEffectEvent(takePaste)
  // While its Pane is the one in use, what is typed or pasted in it
  // outside a field comes here.
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const box = form.current
    if (!focused || !box) return
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      asText.current = mod && event.shiftKey && event.code === "KeyV"
      const text = typed(event, box)
      if (text === undefined) return
      event.preventDefault()
      field.current?.add(text)
    }
    const onPaste = (event: ClipboardEvent) => {
      if (!stray(event, box) || takePasteLater(event, "end")) return
      const text = event.clipboardData?.getData("text/plain")
      if (!text) return
      event.preventDefault()
      field.current?.add(text)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("paste", onPaste)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("paste", onPaste)
    }
  }, [focused])

  // The word being typed that asks for suggestions: `/` or `@`.
  const [typing, setTyping] = useState<Typing>()
  const pick = (command: Suggested) => {
    if (command.planMode === undefined) {
      field.current?.complete(`/${command.name} `)
    } else {
      onPlanMode(command.planMode)
      field.current?.complete("")
    }
  }
  const slash = useSlashMenu({
    text,
    word: typing?.trigger === "/" ? typing.word : undefined,
    commands,
    name,
    onPick: pick,
  })
  const fileMenu = useFileMenu({
    text,
    word: typing?.trigger === "@" ? typing.word : undefined,
    findFiles,
    onPick: (path) => field.current?.complete({ chip: "file", value: path }),
  })

  const trimmed = text.trim().length
  const written = trimmed > 0 || images.adding.length > 0
  // How far past the longest message a Harness takes it is, if it is.
  const over = trimmed - LONGEST
  const ready = written && over <= 0 && !busy && !images.busy
  const send = async (steer: boolean) => {
    if (!ready) return
    // A message that is only `/plan` or `/default` switches plan mode.
    const mode =
      images.adding.length === 0 ? ownCommand(text, commands) : undefined
    if (mode !== undefined) {
      onPlanMode(mode)
      setText("")
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
      ref={form}
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
            <AttachmentList images={images} />
          </InputGroupAddon>
        )}
        <PromptEditor
          ref={field}
          value={text}
          placeholder={placeholder ?? `Write to ${name}. @ files, / commands`}
          attributes={{
            "aria-label": `Message to ${name}`,
            "data-slot": "input-group-control",
            ...slash.field,
            ...fileMenu.field,
          }}
          className="max-h-48 min-h-10"
          onTyping={setTyping}
          onChange={(value) => {
            setText(value)
            setBack(0)
          }}
          onPaste={(event) => takePaste(event, "caret")}
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
              if (!(field.current?.atEdge(up) ?? true)) return
              const waits = onEditLast !== undefined
              const step = recall(history(), back, text, up, waits)
              if (!step) return
              event.preventDefault()
              if (step === "edit") return onEditLast?.()
              setText(step.text)
              setBack(step.back)
              return
            }
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.isComposing
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
      {over > 0 && (
        <p role="alert" className="px-1 text-xs text-destructive">
          The message is {over.toLocaleString("en-US")}{" "}
          {over === 1 ? "character" : "characters"} over the{" "}
          {LONGEST.toLocaleString("en-US")}-character limit. Shorten or split it
          before sending.
        </p>
      )}
    </form>
  )
}

/** What the window may do to a composer: give it files dropped on the
 * Pane. */
export type ComposerHandle = {
  take: (files: File[]) => void
  /** Quotes `text` in the message, on lines of its own. */
  quote: (text: string) => void
}

/** A pasted text this long or longer is kept as a file, as in T3 Code. */
const LONG_PASTE = 32 * 1024
/** A long text kept as a file, as the message names it. */
const PASTED = /pasted-text-\d+\.txt/g

/** Whether a pasted text is {@link LONG_PASTE} bytes or more: a character
 * is one byte or more, and at most three. */
function long(text: string): boolean {
  if (text.length * 3 < LONG_PASTE) return false
  return text.length >= LONG_PASTE || new Blob([text]).size >= LONG_PASTE
}

/** The longest message a Harness takes, as in T3 Code. */
const LONGEST = 120_000

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

/** Whether a key comes with no modifier held. */
function plain(event: KeyboardEvent): boolean {
  return !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey
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
