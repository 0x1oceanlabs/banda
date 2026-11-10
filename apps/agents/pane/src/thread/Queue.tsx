import { useState } from "react"
import { Bubble, BubbleContent } from "@banda/ui/components/bubble"
import { Button } from "@banda/ui/components/button"
import { Message, MessageContent } from "@banda/ui/components/message"
import { Textarea } from "@banda/ui/components/textarea"
import { cn } from "@banda/ui/lib/utils"
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import { PauseIcon, PlayIcon } from "lucide-react"
import { type ImageReader, MessageImages } from "../entries/parts/MessageImages"
import type { ItemId, ListedThread } from "@banda/contract/agents"
import { type Waiting, writerOf } from "./state"
import { THREAD_ZOOM, Writer, type Writers } from "../entries/parts/Messages"

/** What a Person does with a message that waits, as T3 Code offers it. */
export type QueueActions = {
  /** Sends it into the turn that runs. */
  onSendNow: (waiting: Waiting) => void
  onEdit: (waiting: Waiting, text: string) => Promise<boolean>
  onRemove: (waiting: Waiting) => void
  /** Lets a held queue go on. */
  onContinue: () => void
  /** The waiting message being edited, if one is. */
  editing?: ItemId
  /** Opens one to edit, or closes the one open. */
  onEditing: (item?: ItemId) => void
}

/**
 * The messages that wait for their turn, after the Thread, each the
 * Person's bubble dashed, with quiet words under it (ADR 0058, decision
 * 8): one can be sent now while the Agent works, changed, or taken back.
 * A queue a stop or a restart held says so, and Continue lets it go on.
 */
export function Queue({
  waiting,
  held,
  steerable,
  name,
  busy,
  reader,
  writers,
  onOpenThread,
  ...actions
}: QueueActions &
  Writers & {
    waiting: Waiting[]
    held: boolean
    /** A turn runs that a message can go into now. */
    steerable: boolean
    name: string
    busy: boolean
    reader: ImageReader
  }) {
  if (waiting.length === 0) return null
  const count =
    waiting.length === 1
      ? "One message waits"
      : `${waiting.length} messages wait`
  return (
    <div className="flex flex-col gap-2">
      {held && (
        <Trace>
          <TraceLine>
            <TraceIcon>
              <PauseIcon />
            </TraceIcon>
            <TraceTitle className="whitespace-normal">
              {count} until you continue.
            </TraceTitle>
          </TraceLine>
          <div className="pl-6">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={busy}
              onClick={actions.onContinue}
            >
              <PlayIcon data-icon="inline-start" />
              Continue
            </Button>
          </div>
        </Trace>
      )}
      <ul aria-label="Waiting messages" className="flex flex-col gap-3">
        {waiting.map((one) => (
          <li key={one.item.id}>
            <WaitingMessage
              waiting={one}
              name={name}
              steerable={steerable}
              busy={busy}
              reader={reader}
              writer={writerOf(writers, one.item)}
              onOpenThread={onOpenThread}
              {...actions}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

function WaitingMessage({
  waiting,
  name,
  steerable,
  busy,
  reader,
  onSendNow,
  onEdit,
  onRemove,
  editing,
  onEditing,
  writer,
  onOpenThread,
}: Omit<QueueActions, "onContinue"> & {
  waiting: Waiting
  name: string
  steerable: boolean
  busy: boolean
  reader: ImageReader
  /** The other Thread whose Agent wrote it, if one did. */
  writer?: ListedThread | "gone"
  onOpenThread: Writers["onOpenThread"]
}) {
  const body = waiting.item.body
  if (body.kind !== "message") return null
  const open = editing === waiting.item.id
  return (
    <Message align="end">
      <MessageContent>
        {writer && (
          <Writer
            thread={writer}
            answers={body.answers}
            align="end"
            onOpen={onOpenThread}
          />
        )}
        <MessageImages images={body.images} reader={reader} />
        {open ? (
          <EditWaiting
            text={body.text}
            busy={busy}
            onSave={async (text) => {
              if (await onEdit(waiting, text)) onEditing()
            }}
            onCancel={() => onEditing()}
          />
        ) : (
          body.text && (
            // The colour on the bubble, not its content, whose prose size
            // a colour given to it would take the place of.
            <Bubble
              variant="outline"
              align="end"
              className={cn("text-muted-foreground", THREAD_ZOOM)}
            >
              <BubbleContent className="border-dashed whitespace-pre-wrap">
                {body.text}
              </BubbleContent>
            </Bubble>
          )
        )}
        {!open && (
          // Quiet, as a sent message's own actions are: meta words, muted
          // until pointed at.
          <div className="-mt-1.5 flex justify-end gap-3 text-xs text-muted-foreground">
            <span>Queued</span>
            {steerable && (
              <Action
                disabled={busy}
                title={`Send it now: ${name} reads it as it works.`}
                onClick={() => onSendNow(waiting)}
              >
                Send now
              </Action>
            )}
            <Action disabled={busy} onClick={() => onEditing(waiting.item.id)}>
              Edit
            </Action>
            <Action disabled={busy} onClick={() => onRemove(waiting)}>
              Remove
            </Action>
          </div>
        )}
      </MessageContent>
    </Message>
  )
}

/** One of a waiting message's actions: a word, the foreground's colour
 * when pointed at or focused. */
function Action(props: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className="rounded-small transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
      {...props}
    />
  )
}

/** A waiting message, open to change: Enter or Save keeps it, Escape or
 * Cancel leaves it as it was. It is the bubble it was, as tall as its
 * text, in the composer's values: the bubble's corner, a block's fill
 * and line, prose. */
function EditWaiting({
  text,
  busy,
  onSave,
  onCancel,
}: {
  text: string
  busy: boolean
  onSave: (text: string) => Promise<void>
  onCancel: () => void
}) {
  const [editing, setEditing] = useState(text)
  return (
    <form
      className="flex w-full max-w-[80%] flex-col gap-2 self-end"
      onSubmit={(event) => {
        event.preventDefault()
        void onSave(editing)
      }}
    >
      <Textarea
        value={editing}
        autoFocus
        aria-label="Waiting message"
        className="min-h-0 rounded-card border-border bg-block px-3.5 text-(length:--prose-size) leading-(--prose-leading) focus-visible:border-foreground/15 focus-visible:ring-0 md:text-(length:--prose-size) dark:bg-block"
        onChange={(event) => setEditing(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            // Its own: not the drawer's, nor anything around it.
            event.stopPropagation()
            onCancel()
          }
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault()
            void onSave(editing)
          }
        }}
      />
      <div className="flex justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" className="text-xs" disabled={busy}>
          Save
        </Button>
      </div>
    </form>
  )
}
