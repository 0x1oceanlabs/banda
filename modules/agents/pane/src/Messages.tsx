import { useState } from "react"
import { GitForkIcon, PencilIcon } from "lucide-react"
import type { Image, ListedThread } from "@banda/contract/agents"
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
import { HarnessLogo } from "@banda/ui/components/harness-logo"
import { Markdown } from "@banda/ui/components/markdown"
import { Message, MessageContent } from "@banda/ui/components/message"
import { cn } from "@banda/ui/lib/utils"
import { clock, fullDate } from "@banda/ui/lib/words"
import { type ImageReader, MessageImages } from "./MessageImages"
import { clamped } from "./messageText"
import type { Listing } from "./thread"

/**
 * The Person's message: a bubble on the right, its long text clamped until
 * they open it (ADR 0010, decision 1).
 */
export function PersonMessage({
  text,
  images,
  at,
  reader,
  onEdit,
}: {
  text: string
  images: Image[]
  at: number
  reader: ImageReader
  /** Takes the Thread back to before it, its text and images back in the
   * composer, as T3 Code's "Edit from here" (ADR 0027, decision 1); null
   * while it cannot. */
  onEdit?: (() => void) | null
}) {
  const clamp = useClamp(text, "max-h-44", "Show full message")
  return (
    <Message align="end">
      <MessageContent>
        <MessageImages images={images} reader={reader} />
        {text && (
          <Bubble variant="muted" align="end">
            <BubbleContent
              className={cn("whitespace-pre-wrap", clamp.className)}
            >
              {text}
            </BubbleContent>
          </Bubble>
        )}
        <Meta
          at={at}
          text={text}
          align="end"
          actions={onEdit !== undefined && <EditFromHere onEdit={onEdit} />}
        >
          {clamp.toggle}
        </Meta>
      </MessageContent>
    </Message>
  )
}

/** The pencil of a Person's message, which asks first, as T3 Code's. */
function EditFromHere({ onEdit }: { onEdit: (() => void) | null }) {
  const [asking, setAsking] = useState(false)
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
  return (
    <Message>
      <MessageContent>
        {from}
        <div data-quotable>
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

/** The Space's other Threads by their Agents' IDs, and how one opens: what
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
        "-mb-1.5 max-w-full text-muted-foreground",
        align === "end" ? "-mr-2 self-end" : "-ml-2 self-start"
      )}
      onClick={gone ? undefined : () => onOpen(thread)}
    >
      {!gone && (
        <HarnessLogo
          id={thread.harness}
          name={thread.harness}
          fallback={null}
        />
      )}
      {says}
      <span className="truncate font-medium text-foreground">
        {gone ? "another Thread" : thread.title || "New Thread"}
      </span>
    </Button>
  )
}

/**
 * Copy, the message's `actions` and the time, shown on hover or focus, and
 * always on a touch screen. `children` come first and stay in view: they
 * are the message's own controls, such as opening a clamped one.
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
  return (
    <div
      data-slot="message-meta"
      className={cn(
        "-mt-1.5 flex h-6 items-center gap-1 text-xs text-muted-foreground",
        align === "end" ? "flex-row-reverse self-end" : "self-start"
      )}
    >
      {children}
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100 pointer-coarse:opacity-100">
        {text && <CopyButton text={text} label="Copy the message" />}
        {actions}
        <time dateTime={new Date(at).toISOString()} title={fullDate(at)}>
          {clock(at)}
        </time>
      </div>
    </div>
  )
}
