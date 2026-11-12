import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import type { Image, Skill, TurnView, Usage } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@banda/ui/components/context-menu"
import {
  PromptEditor,
  type PromptEditorHandle,
} from "@banda/ui/components/prompt-editor"
import { useScope } from "@banda/ui/hooks/use-scope"
import { quoted } from "@banda/ui/lib/prompt"
import { PlusIcon } from "lucide-react"
import { COMPOSER } from "../scopes"
import { AttachmentList, type Attachments } from "./Attachments"
import { CommentList } from "./CommentList"
import type { Comment } from "./comments"
import { ComposerMenu } from "./ComposerMenu"
import { ContextUsed } from "./ContextUsed"
import { useDraft, useDraftComments } from "./drafts"
import { steers, useEnterKey } from "./enter-key"
import type { FindFiles } from "./FileMenu"
import { FOOTER_CONTROL, FOOTER_ICON } from "./footer"
import { recall } from "./history"
import { useIntake } from "./intake"
import { LONGEST, measure, sendable } from "./message"
import { placeholder as says } from "./placeholder"
import { SendButton } from "./SendButton"
import { ownCommand, type Suggested } from "./slash"
import { useStray } from "./stray"
import { useSuggestions } from "./suggestions"

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
 * In a started Thread, Send then reads "Send when back" instead, and the
 * message waits for that machine (ADR 0105, Q2).
 */
export function Composer({
  name,
  thread,
  history,
  placeholder,
  machine,
  held,
  whenBack,
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
  /** The key its draft is kept under: its Thread's, or a new Thread's own
   * (`useDraftKey`); with none, only while its Pane is open. */
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
  /** While the message would wait for the machine instead, Send's
   * tooltip at a time: the button reads "Send when back", and it and Enter
   * send it to wait. */
  whenBack?: (now: number) => string
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
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (focused) field.current?.focus()
  }, [focused])

  const intake = useIntake({ field, images, keep, text })
  // While its Pane is the one in use, what is typed or pasted in it
  // outside a field comes here.
  useStray(form, focused, {
    add: (typed) => field.current?.add(typed),
    onKey: intake.heardKey,
    onPaste: (event) => intake.takePaste(event, "end"),
  })
  const suggestions = useSuggestions({
    field,
    text,
    name,
    commands,
    skills,
    findFiles,
    onPlanMode,
  })
  const skillNames = useMemo(
    () => new Set(skills.map((skill) => skill.name)),
    [skills]
  )

  useImperativeHandle(ref, () => ({
    take: (given) => void intake.take(given, "end"),
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

  const { message, written, over } = measure(
    text,
    comments,
    images.adding.length
  )
  const ready = sendable({ written, over, busy: busy || images.busy, held })
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
  // The composer's keys (ADR 0071, decision 1). A key its suggestions or
  // its text take, as Enter in code, stays theirs.
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
    {
      owns: (event) =>
        suggestions.onKeyDown(event) ||
        (field.current?.textKey(event) ?? false),
    }
  )

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
        <p role="alert" className="px-1 text-meta text-destructive">
          {images.problem}
        </p>
      )}
      {suggestions.menu}
      <input
        ref={files}
        type="file"
        multiple
        hidden
        aria-label="Files to add"
        onChange={(event) => {
          // As when dropped: images as images, any other file named.
          void intake.take([...(event.target.files ?? [])], "caret")
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
                  ...suggestions.field,
                }}
                className="max-h-48 px-3.5 pt-3 pb-1.5"
                onTyping={suggestions.onTyping}
                onChange={(value) => {
                  setText(value)
                  setBack(0)
                }}
                onPaste={(event) => intake.takePaste(event, "caret")}
                // Its suggestions' own keys; the rest are the composer's
                // actions, which its scope runs (`keys`).
                onKeyDown={suggestions.onKeyDown}
              />
            </div>
          </ContextMenuTrigger>
          <ComposerMenu
            field={field}
            paste={
              paste &&
              ((plain) => {
                // As Ctrl+Shift+V: long text stays text, not a file.
                intake.pasteAsText(plain)
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
          <SendButton
            name={name}
            enter={enter}
            steering={steering}
            working={working}
            written={written}
            ready={ready}
            busy={busy}
            held={held}
            whenBack={whenBack}
            onStop={onStop}
            onSend={(steer) => void send(steer)}
          />
        </div>
      </div>
      {over > 0 && (
        <p role="alert" className="px-1 text-meta text-destructive">
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
