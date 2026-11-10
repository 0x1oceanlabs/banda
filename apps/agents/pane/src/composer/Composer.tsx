import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import type {
  Enter,
  Image,
  Skill,
  TurnView,
  Usage,
} from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import {
  PromptEditor,
  type PromptEditorHandle,
  type Typing,
} from "@banda/ui/components/prompt-editor"
import { RingMeter } from "@banda/ui/components/ring-meter"
import { quoted } from "@banda/ui/lib/prompt"
import { cn } from "@banda/ui/lib/utils"
import { Spinner } from "@banda/ui/components/spinner"
import {
  ArrowUpIcon,
  CornerUpRightIcon,
  MessageSquareIcon,
  PlusIcon,
  ListPlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@banda/ui/components/context-menu"
import { AttachmentList, type Attachments } from "./Attachments"
import {
  type Comment,
  commentAt,
  commentLabel,
  commentStart,
  withComments,
} from "./comments"
import { ComposerMenu } from "./ComposerMenu"
import { useDraft, useDraftComments } from "./drafts"
import { keyFor, steers, useEnterKey } from "./enter-key"
import { recall } from "./history"
import { imagesAmong } from "./images"
import { placeholder as says } from "./placeholder"
import { ownCommand, type Suggested } from "./slash"
import { type FindFiles, useFileMenu } from "./FileMenu"
import { useSkillMenu, useSlashMenu } from "./SlashMenu"
import { stray, typed } from "./stray"
import { useScope } from "@banda/ui/hooks/use-scope"
import { COMPOSER } from "../scopes"

/**
 * Where a Person writes to the Agent: the text, with the slash commands
 * it can start with; the images it carries, added with the button or by
 * pasting them; and Send, or Stop while the Agent works and nothing is
 * written. While the Agent works, a message goes into its turn or waits
 * for the turn to end: Enter and the button do what agents.toml says,
 * into the turn as T3 Code's default, and Ctrl+Enter or Ctrl+click the
 * other. As in T3 Code, ↑ and ↓ in an empty box walk the earlier
 * messages, after the last one that waits, which ↑ opens to edit; and
 * what is written waits as the Thread's draft. Comments on files' lines an
 * App puts in it wait above the text, each to take out, and go after the
 * text as the Agent reads them (ADR 0034, decision 9). On another
 * machine's Thread it names that machine, and while it cannot reach it,
 * Send waits and says why; what is written stays (ADR 0095, decision 7).
 */
export function Composer({
  name,
  thread,
  history,
  placeholder,
  machine,
  held,
  plan,
  focused,
  busy,
  working,
  steering,
  usage,
  commands,
  skills,
  images,
  dropping,
  onPlanMode,
  findFiles,
  keep,
  onEditLast,
  onSend,
  onStop,
  paste,
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

  /** What the empty box says, instead of asking to write to `name` or,
   * while a turn runs, to steer it. */
  placeholder?: string
  /** The machine it writes to, by its name, when it is another machine's
   * Thread; none for this machine's. */
  machine?: string
  /** Why Send waits, while the machine cannot be reached: Enter and the
   * button send nothing, and what is written stays. */
  held?: string
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
  /** The skills a message can name anywhere with `$`, suggested as their
   * names are typed. */
  skills: Skill[]
  /** The images the message carries. */
  images: Attachments
  /** Images are dragged over the Pane, to drop them here. */
  dropping: boolean
  /** Switches the Thread's plan mode, for `/plan` and `/default`. */
  onPlanMode: (on: boolean) => void
  /** Finds files in the Project's folder, for `@`. */
  findFiles?: FindFiles
  /** Keeps a file in the Project for the message to name; resolves its
   * path, or nothing if it could not be kept. */
  keep: (file: File) => Promise<string | undefined>
  /** Opens the last message that waits to edit; given while one does. */
  onEditLast?: () => void
  /** Sends the text and the images, into the turn that runs if `steer`;
   * resolves whether it went. */
  onSend: (text: string, images: Image[], steer: boolean) => Promise<boolean>
  onStop: (turn: TurnView) => void
  /** Pastes what the clipboard holds into the focused field, or its text
   * alone; none where no window does. */
  paste?: (plain: boolean) => void
  /** What the Thread runs with, beside the send button. */
  children?: React.ReactNode
  ref?: React.Ref<ComposerHandle>
}) {
  const [text, setText] = useDraft(thread)
  const [comments, setComments] = useDraftComments(thread)
  // How far back ↑ has walked the history; 0 for not at all.
  const [back, setBack] = useState(0)
  const enter = useEnterKey()
  const field = useRef<PromptEditorHandle>(null)
  const files = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focused) field.current?.focus()
  }, [focused])
  // Files dropped or pasted join the message: images as images, any other
  // kept in the Project and named in the text, in turn, as `@` names a file.
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
    point: (path) => field.current?.point(path, "caret"),
    comment: (added) => setComments((all) => [...all, ...added]),
    putBack: (back, carried) => {
      images.putBack(carried)
      field.current?.add(text && back ? `\n${back}` : back)
    },
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
    // It holds for this paste alone.
    const asIs = asText.current
    asText.current = false
    if (data.files.length > 0) void take([...data.files], at)
    else if (!asIs && long(pasted)) {
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

  // The word being typed that asks for suggestions: `/`, `@` or `$`.
  const [typing, setTyping] = useState<Typing>()
  const skillNames = useMemo(
    () => new Set(skills.map((skill) => skill.name)),
    [skills]
  )
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
  const skillMenu = useSkillMenu({
    text,
    word: typing?.trigger === "$" ? typing.word : undefined,
    skills,
    onPick: (skill) =>
      field.current?.complete({ chip: "skill", value: skill.name }),
  })
  const fileMenu = useFileMenu({
    text,
    word: typing?.trigger === "@" ? typing.word : undefined,
    findFiles,
    onPick: (path) => field.current?.complete({ chip: "file", value: path }),
  })

  // At most one is open, for the word being typed.
  const menus = [slash, fileMenu, skillMenu]
  // The composer's keys (ADR 0071, decision 1). A key its suggestions or
  // its text take, as Enter in code, stays theirs.
  const owned = (event: KeyboardEvent) =>
    menus.some((menu) => menu.onKeyDown(event)) ||
    (field.current?.textKey(event) ?? false)
  const recalled = (up: boolean) => {
    // Within a message of more lines, the caret moves first.
    if (!(field.current?.atEdge(up) ?? true)) return false
    const step = recall(history(), back, text, up, onEditLast !== undefined)
    if (!step) return false
    if (step === "edit") onEditLast?.()
    else {
      setText(step.text)
      setBack(step.back)
    }
    return true
  }
  const scope = useScope(
    COMPOSER,
    {
      "agents.composer.send": () => {
        void send(steers(enter, false))
        return true
      },
      "agents.composer.send-other": () => {
        void send(steers(enter, true))
        return true
      },
      "agents.composer.newline": () => {
        field.current?.newLine()
        return true
      },
      "agents.composer.back": () => recalled(true),
      "agents.composer.forward": () => recalled(false),
      "agents.composer.plan": () => {
        if (plan === undefined) return false
        onPlanMode(!plan)
        return true
      },
    },
    { owns: owned }
  )

  // The message as it goes: the text, then the comments.
  const message = withComments(text, comments)
  const trimmed = message.trim().length
  const written = trimmed > 0 || images.adding.length > 0
  // How far past the longest message a Harness takes it is, if it is.
  const over = trimmed - LONGEST
  const ready = sendable({
    written,
    over,
    busy: busy || images.busy,
    held,
  })
  const send = async (steer: boolean) => {
    if (!ready) return
    // A message that is only `/plan` or `/default` switches plan mode.
    const mode =
      images.adding.length === 0 && comments.length === 0
        ? ownCommand(text, commands)
        : undefined
    if (mode !== undefined) {
      onPlanMode(mode)
      setText("")
      return
    }
    const sending = images.attached
    const commented = comments
    if (await onSend(message, sending, steer && steering)) {
      // What the Person wrote while it went stays.
      setText((now) => (now === text ? "" : now))
      setBack(0)
      images.sent(sending)
      setComments((all) => all.filter((one) => !commented.includes(one)))
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
      {skillMenu.menu}
      <input
        ref={files}
        type="file"
        multiple
        hidden
        aria-label="Files to add"
        onChange={(event) => {
          // As when dropped: images as images, any other file named.
          void take([...(event.target.files ?? [])], "caret")
          event.target.value = ""
        }}
      />
      {/* The shape of what docks on it (ADR 0058, decision 8): the
          bubble's corner, a block's fill and a line, one recipe in light
          and dark; the line firms up while it is in use. Files dragged
          over tint it (ADR 0031). The pictures and the text start at one
          inset. */}
      <div
        data-dropping={dropping || undefined}
        className="flex flex-col rounded-card border bg-block transition-colors focus-within:border-foreground/15 data-dropping:border-primary data-dropping:bg-accent/45"
      >
        {images.adding.length > 0 && (
          <div className="px-3.5 pt-3">
            <AttachmentList images={images} />
          </div>
        )}
        {comments.length > 0 && (
          <CommentList
            comments={comments}
            onRemove={(id) =>
              setComments((all) => all.filter((one) => one.id !== id))
            }
          />
        )}
        <ContextMenu>
          <ContextMenuTrigger render={<div className="contents" />}>
            <div ref={scope} className="contents">
              <PromptEditor
                ref={field}
                value={text}
                placeholder={
                  placeholder ??
                  says(name, steering, skills.length > 0, machine)
                }
                skills={skillNames}
                attributes={{
                  "aria-label": `Message to ${name}`,
                  ...Object.assign({}, ...menus.map((menu) => menu.field)),
                }}
                className="max-h-48 px-3.5 pt-3 pb-1.5"
                onTyping={setTyping}
                onChange={(value) => {
                  setText(value)
                  setBack(0)
                }}
                onPaste={(event) => takePaste(event, "caret")}
                // Its suggestions' own keys; the rest are the composer's
                // actions, which its scope runs (`keys`).
                onKeyDown={(event) => {
                  menus.some((menu) => menu.onKeyDown(event))
                }}
              />
            </div>
          </ContextMenuTrigger>
          <ComposerMenu
            field={field}
            paste={
              paste &&
              ((plain) => {
                // As Ctrl+Shift+V: long text stays text, not a file.
                asText.current = plain
                paste(plain)
              })
            }
          />
        </ContextMenu>
        {/* One row: + on the left, what is on beside it; what the Thread
            runs with and the button on the right (ADR 0031), every one
            28px (ADR 0058, decision 8). */}
        <div className="flex items-center gap-0.5 px-2 pt-1 pb-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className={FOOTER_ICON}
            aria-label="Add files"
            title="Add images and files"
            onClick={() => files.current?.click()}
          >
            <PlusIcon />
          </Button>
          {plan && (
            <Button
              variant="ghost"
              size="sm"
              className={FOOTER_CONTROL}
              aria-label="Plan"
              title="Plan mode is on. Click, Shift+Tab or /default turns it off."
              onClick={() => onPlanMode(false)}
            >
              Plan
            </Button>
          )}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5">
            {children}
          </div>
          {usage && <ContextUsed usage={usage} />}
          {working && !written ? (
            <Button
              size="icon-sm"
              className="ml-1 rounded-full"
              aria-label="Stop"
              onClick={() => onStop(working)}
            >
              <SquareIcon className="size-2.5 fill-current" />
            </Button>
          ) : (
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
                void send(steers(enter, event.ctrlKey || event.metaKey))
              }}
            >
              {busy ? <Spinner /> : look.icon}
            </Button>
          )}
        </div>
      </div>
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
  /** Names the file at `path` in the message, as `@` does, at the caret. */
  point: (path: string) => void
  /** Puts comments on files' lines in the message, after those there. */
  comment: (comments: Comment[]) => void
  /** Puts a message back, after what is written, the caret at its end:
   * its text, and the images it carried (ADR 0027, decision 1). */
  putBack: (text: string, images: Image[]) => void
}

/** The comments on files' lines the message carries, each a chip with
 * its file, its lines and the start of its words, to take out. */
function CommentList({
  comments,
  onRemove,
}: {
  comments: readonly Comment[]
  onRemove: (id: string) => void
}) {
  return (
    <ul aria-label="Comments" className="flex flex-wrap gap-1.5 px-3.5 pt-3">
      {comments.map((one) => {
        const start = commentStart(one.comment)
        return (
          <li
            key={one.id}
            data-comment
            title={`${commentAt(one)}${one.comment ? `: ${one.comment}` : ""}`}
            className="flex h-6 max-w-full min-w-0 items-center gap-1 rounded-control bg-raised pr-0.5 pl-1.5 text-xs"
          >
            <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 font-mono text-[11px]">
              {commentLabel(one)}
            </span>
            {start && (
              <span className="min-w-0 truncate text-muted-foreground">
                {start}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-5 shrink-0 text-muted-foreground"
              aria-label={`Remove the comment on ${commentLabel(one)}`}
              onClick={() => onRemove(one.id)}
            >
              <XIcon />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

/** A control in the composer's footer (ADR 0058, decision 8): 28px with a
 * button's corner, its words meta-sized, muted until hovered or open;
 * its hover the raised fill, which shows on the composer's block. For a
 * ghost `Button` of size `sm`. */
export const FOOTER_CONTROL =
  "h-7 gap-1.5 rounded-control px-2 text-xs font-normal text-muted-foreground hover:bg-raised hover:text-foreground aria-expanded:bg-raised aria-expanded:text-foreground dark:hover:bg-raised"

/** {@link FOOTER_CONTROL} with only an icon, for a ghost `Button` of size
 * `icon-sm`. */
export const FOOTER_ICON =
  "rounded-control text-muted-foreground hover:bg-raised hover:text-foreground aria-expanded:bg-raised aria-expanded:text-foreground dark:hover:bg-raised [&_svg:not([class*='size-'])]:size-3.5"

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

/**
 * Whether Enter and Send send the message now: something is `written`, no
 * longer than a Harness takes (`over` it by none), with nothing on its way
 * (`busy`); never while Send is `held`, when the machine it goes to cannot
 * be reached, and the message waits as the draft.
 */
export function sendable({
  written,
  over,
  busy,
  held,
}: {
  written: boolean
  over: number
  busy: boolean
  held?: string
}): boolean {
  return written && over <= 0 && !busy && held === undefined
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

/** From this share of its context used, how full it is shows. */
const HALF_FULL = 50

/** From this share of its context used, an Agent is near the point where
 * its Harness compacts or stops: the share shows as a warning. */
const NEARLY_FULL = 80

/** How full the Agent's context is, from half full: a ring, and the
 * share; what it cost so far on hover, when the Harness says. */
function ContextUsed({ usage: { used, size, cost } }: { usage: Usage }) {
  const share = size > 0 ? Math.round((used / size) * 100) : 0
  if (share < HALF_FULL) return null
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
      className="flex h-7 shrink-0 items-center gap-1.5 px-1.5 text-xs text-muted-foreground tabular-nums data-full:text-destructive"
    >
      <RingMeter
        className="size-3.5"
        value={share}
        aria-label="Context used"
        getAriaValueText={() => words}
      />
      {share}%
    </span>
  )
}
