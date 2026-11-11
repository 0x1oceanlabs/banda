import { Fragment, useState } from "react"
import { GitForkIcon, PencilIcon } from "lucide-react"
import type { Image, ListedThread, Subagent } from "@banda/contract/agents"
import { Bubble, BubbleContent } from "@banda/ui/components/bubble"
import { Button } from "@banda/ui/components/button"
import { CopyButton } from "@banda/ui/components/copy-button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { Emblem, emblemOf } from "@banda/ui/components/emblem"
import { Markdown } from "@banda/ui/components/markdown"
import { Message, MessageContent } from "@banda/ui/components/message"
import { Satellite } from "@banda/ui/components/satellite"
import { cn } from "@banda/ui/lib/utils"
import { fullDate } from "@banda/ui/lib/words"
import { clock } from "@banda/core/react"
import { type ImageReader, MessageImages } from "./MessageImages"
import { clamped, piecesOf } from "./messageText"
import { lookOf } from "../../thread/subagents"
import { useMessageMenu } from "../../thread/ThreadMenu"
import type { Listing } from "../../thread/state"

/** What the Thread's text size sizes: a reply, the Person's message, a
 * plan, with their code (ADR 0063, decision 5). The header, the work
 * lines and the composer keep theirs. */
export const THREAD_ZOOM = "[zoom:var(--thread-zoom,1)]"

/**
 * The Person's message: a bubble on the right, its long text clamped until
 * they open it (ADR 0010, decision 1).
 */
export function PersonMessage({
  text,
  images,
  about,
  at,
  reader,
  onEdit,
}: {
  text: string
  images: Image[]
  /** The Thread's sub-agents by their labels, each a chip where the
   * message is about it (ADR 0103, decision 25). */
  about?: ReadonlyMap<string, Subagent>
  at: number
  reader: ImageReader
  /** Takes the Thread back to before it, its text and images back in the
   * composer, as T3 Code's "Edit from here" (ADR 0027, decision 1); null
   * while it cannot. */
  onEdit?: (() => void) | null
}) {
  const clamp = useClamp(text, "max-h-44", "Show full message")
  // The pencil and the Thread's menu ask the same question.
  const [asking, setAsking] = useState(false)
  const menu = useMessageMenu({
    kind: "message",
    text,
    edit: onEdit && (() => setAsking(true)),
  })
  return (
    <Message align="end" ref={menu}>
      <MessageContent>
        <MessageImages images={images} reader={reader} />
        {text && (
          <Bubble variant="muted" align="end" className={THREAD_ZOOM}>
            <BubbleContent
              className={cn("whitespace-pre-wrap", clamp.className)}
            >
              {about ? <Chipped text={text} about={about} /> : text}
            </BubbleContent>
          </Bubble>
        )}
        <Meta
          at={at}
          text={text}
          align="end"
          actions={
            onEdit !== undefined && (
              <EditFromHere
                onEdit={onEdit}
                asking={asking}
                onAsking={setAsking}
              />
            )
          }
        >
          {clamp.toggle}
        </Meta>
      </MessageContent>
    </Message>
  )
}

/** A Person's message's text with a chip for each sub-agent it is about,
 * as the composer showed it: its satellite, as it stands now, then its
 * label. The bubble stays text, not an editor. */
function Chipped({
  text,
  about,
}: {
  text: string
  about: ReadonlyMap<string, Subagent>
}) {
  return piecesOf(text, about).map((piece, at) => {
    if ("text" in piece) return <Fragment key={at}>{piece.text}</Fragment>
    const lane = about.get(piece.about)!
    return (
      <span
        key={at}
        data-slot="subagent-chip"
        title={piece.about}
        className="mx-px inline-flex items-baseline gap-1 rounded-small bg-foreground/9 px-1 align-baseline"
      >
        <Satellite state={lookOf(lane)} size={8} className="self-center" />
        {piece.about}
      </span>
    )
  })
}

/** The pencil of a Person's message, which asks first, as T3 Code's. */
function EditFromHere({
  onEdit,
  asking,
  onAsking: setAsking,
}: {
  onEdit: (() => void) | null
  asking: boolean
  onAsking: (asking: boolean) => void
}) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Edit from here"
        title="Edit from here"
        disabled={onEdit === null}
        onClick={() => setAsking(true)}
      >
        <PencilIcon />
      </Button>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit from here?</DialogTitle>
            <DialogDescription>
              The Thread goes back to before this message, and its text and
              images return to the composer. Files the Agent changed stay as
              they are.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              onClick={() => {
                setAsking(false)
                onEdit?.()
              }}
            >
              Edit from here
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Long text clamped to `height` until its Person opens it, as in T3
 * Code: the class that clamps it, and the button that opens it, which says
 * `more`. Neither, for short text. */
export function useClamp(text: string, height: string, more: string) {
  const long = clamped(text)
  const [open, setOpen] = useState(false)
  return {
    className:
      long && !open
        ? cn(height, "overflow-hidden mask-b-from-60% mask-b-to-100%")
        : undefined,
    toggle: long && (
      <Button
        variant="ghost"
        size="xs"
        className="self-start"
        onClick={() => setOpen(!open)}
      >
        {open ? "Show less" : more}
      </Button>
    ),
  }
}

/** The Agent's reply: markdown as prose, without a bubble. */
export function AgentMessage({
  text,
  at,
  live,
  from,
  onFork,
}: {
  text: string
  at: number
  /** Whether the Agent is still writing it. */
  live: boolean
  /** Another Thread's Agent wrote it: the {@link Writer} over it. */
  from?: React.ReactNode
  /** Forks the Thread at the end of the reply's turn, as T3 Code's "Fork
   * from this response" (ADR 0027, decision 3); null while it cannot. */
  onFork?: (() => void) | null
}) {
  const menu = useMessageMenu({ kind: "reply", text, fork: onFork })
  return (
    <Message>
      <MessageContent>
        {from}
        <div data-quotable ref={menu} className={THREAD_ZOOM}>
          <Markdown streaming={live}>{text}</Markdown>
        </div>
        {!live && (
          <Meta
            at={at}
            text={text}
            align="start"
            actions={
              onFork !== undefined && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Fork from this response"
                  title="Fork from this response"
                  disabled={onFork === null}
                  onClick={onFork ?? undefined}
                >
                  <GitForkIcon />
                </Button>
              )
            }
          />
        )}
      </MessageContent>
    </Message>
  )
}

/** The Project's other Threads by their Agents' IDs, and how one opens: what
 * a {@link Writer} needs. */
export type Writers = {
  writers: Listing
  onOpenThread: (thread: ListedThread) => void
}

/**
 * The other Thread whose Agent wrote a message, over it: whether it asks
 * or answers, and that Thread's Harness and title, which opens it (ADR
 * 0019). A Thread the list no longer has is "another Thread", and opens
 * nothing.
 */
export function Writer({
  thread,
  answers = false,
  says = answers ? "Answered by" : "Asked by",
  align = "start",
  onOpen,
}: {
  thread: ListedThread | "gone"
  /** It answers what this Thread's Agent asked; else it asks. */
  answers?: boolean
  /** What the line says of `thread`, if not that it asks or answers. */
  says?: string
  align?: "start" | "end"
  onOpen: (thread: ListedThread) => void
}) {
  const gone = thread === "gone"
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={gone}
      className={cn(
        "-mb-1.5 max-w-full font-normal text-muted-foreground",
        align === "end" ? "-mr-2 self-end" : "-ml-2 self-start"
      )}
      onClick={gone ? undefined : () => onOpen(thread)}
    >
      {!gone && <Emblem of={emblemOf([], thread.harness)} />}
      {says}
      <span className="truncate text-foreground">
        {gone ? "another Thread" : thread.title || "New Thread"}
      </span>
    </Button>
  )
}

/**
 * Copy, the message's `actions` and the time, shown on hover or focus, and
 * always on a touch screen. They take no room until shown (ADR 0058,
 * decision 1): they show over the room under the message, which the
 * Thread keeps for them. `children` come first and stay in view: they are
 * the message's own controls, such as opening a clamped one, so with them
 * the row takes its room.
 */
function Meta({
  at,
  text,
  align,
  actions,
  children,
}: {
  at: number
  text: string
  align: "start" | "end"
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  const floats = !children
  return (
    <div
      data-slot="message-meta"
      className={cn(
        "flex h-6 items-center gap-1 text-meta text-muted-foreground [&_button_svg:not([class*='size-'])]:size-3.5",
        floats
          ? "absolute top-full z-10 -mt-0.5 pointer-coarse:relative pointer-coarse:top-auto pointer-coarse:-mt-1.5"
          : "-mt-1.5",
        align === "end"
          ? "end-0 flex-row-reverse self-end"
          : "start-0 self-start"
      )}
    >
      {children}
      <div className="pointer-events-none flex items-center gap-1 opacity-0 transition-opacity group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
        {text && <CopyButton text={text} label="Copy the message" />}
        {actions}
        <time dateTime={new Date(at).toISOString()} title={fullDate(at)}>
          {clock(at)}
        </time>
      </div>
    </div>
  )
}
