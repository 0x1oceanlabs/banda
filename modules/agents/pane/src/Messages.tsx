import { useState } from "react"
import type { Image } from "@bandaso/contract/agents"
import { Bubble, BubbleContent } from "@bandaso/ui/components/bubble"
import { Button } from "@bandaso/ui/components/button"
import { CopyButton } from "@bandaso/ui/components/copy-button"
import { Markdown } from "@bandaso/ui/components/markdown"
import { Message, MessageContent } from "@bandaso/ui/components/message"
import { cn } from "@bandaso/ui/lib/utils"
import { clock, fullDate } from "@bandaso/ui/lib/words"
import { type ImageReader, MessageImages } from "./MessageImages"
import { clamped } from "./messages"

/**
 * The Person's message: a bubble on the right, its long text clamped until
 * they open it (ADR 0010, decision 1).
 */
export function PersonMessage({
  text,
  images,
  at,
  reader,
}: {
  text: string
  images: Image[]
  at: number
  reader: ImageReader
}) {
  const long = clamped(text)
  const [open, setOpen] = useState(false)
  return (
    <Message align="end">
      <MessageContent>
        <MessageImages images={images} reader={reader} />
        {text && (
          <Bubble variant="muted" align="end">
            <BubbleContent
              className={cn(
                "rounded-2xl whitespace-pre-wrap",
                long &&
                  !open &&
                  "max-h-44 overflow-hidden mask-b-from-60% mask-b-to-100%"
              )}
            >
              {text}
            </BubbleContent>
          </Bubble>
        )}
        <Meta at={at} text={text} align="end">
          {long && (
            <Button variant="ghost" size="xs" onClick={() => setOpen(!open)}>
              {open ? "Show less" : "Show full message"}
            </Button>
          )}
        </Meta>
      </MessageContent>
    </Message>
  )
}

/** The Agent's reply: markdown as prose, without a bubble. */
export function AgentMessage({
  text,
  at,
  live,
}: {
  text: string
  at: number
  /** Whether the Agent is still writing it. */
  live: boolean
}) {
  return (
    <Message>
      <MessageContent>
        <Markdown streaming={live}>{text}</Markdown>
        {!live && <Meta at={at} text={text} align="start" />}
      </MessageContent>
    </Message>
  )
}

/**
 * Copy and the time, shown on hover or focus, and always on a touch screen.
 * `children` come first and stay in view: they are the message's own
 * controls, such as opening a clamped one.
 */
function Meta({
  at,
  text,
  align,
  children,
}: {
  at: number
  text: string
  align: "start" | "end"
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
        <time dateTime={new Date(at).toISOString()} title={fullDate(at)}>
          {clock(at)}
        </time>
      </div>
    </div>
  )
}
