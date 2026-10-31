import { useState } from "react"
import { Bubble, BubbleContent } from "@bandaso/ui/components/bubble"
import { Button } from "@bandaso/ui/components/button"
import { Message, MessageContent } from "@bandaso/ui/components/message"
import { Textarea } from "@bandaso/ui/components/textarea"
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@bandaso/ui/components/trace"
import {
  CornerDownRightIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  XIcon,
} from "lucide-react"
import { type ImageReader, MessageImages } from "./MessageImages"
import type { Waiting } from "./thread"

/** What a Person does with a message that waits, as T3 Code offers it. */
export type QueueActions = {
  /** Sends it into the turn that runs. */
  onSendNow: (waiting: Waiting) => void
  onEdit: (waiting: Waiting, text: string) => Promise<boolean>
  onRemove: (waiting: Waiting) => void
  /** Lets a held queue go on. */
  onContinue: () => void
}

/**
 * The messages that wait for their turn, after the Thread, each dashed:
 * one can be sent now while the Agent works, changed, or taken back. A
 * queue a stop or a restart held says so, and Continue lets it go on.
 */
export function Queue({
  waiting,
  held,
  steerable,
  name,
  busy,
  reader,
  ...actions
}: QueueActions & {
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
              size="xs"
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
}: Omit<QueueActions, "onContinue"> & {
  waiting: Waiting
  name: string
  steerable: boolean
  busy: boolean
  reader: ImageReader
}) {
  const [editing, setEditing] = useState<string>()
  const body = waiting.item.body
  if (body.kind !== "message") return null
  const save = async () => {
    if (editing === undefined) return
    if (await onEdit(waiting, editing)) setEditing(undefined)
  }
  return (
    <Message align="end">
      <MessageContent>
        <MessageImages images={body.images} reader={reader} />
        {editing !== undefined ? (
          <form
            className="flex w-full max-w-[80%] flex-col gap-2 self-end"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <Textarea
              value={editing}
              autoFocus
              aria-label="Waiting message"
              className="min-h-16"
              onChange={(event) => setEditing(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(undefined)
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  void save()
                }
              }}
            />
            <div className="flex justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </Button>
              <Button type="submit" size="xs" disabled={busy}>
                Save
              </Button>
            </div>
          </form>
        ) : (
          body.text && (
            <Bubble variant="outline" align="end">
              <BubbleContent className="border-dashed whitespace-pre-wrap text-muted-foreground">
                {body.text}
              </BubbleContent>
            </Bubble>
          )
        )}
        {editing === undefined && (
          <div className="flex justify-end gap-1">
            {steerable && (
              <Button
                variant="ghost"
                size="xs"
                disabled={busy}
                title={`Send it now: ${name} reads it as it works.`}
                onClick={() => onSendNow(waiting)}
              >
                <CornerDownRightIcon data-icon="inline-start" />
                Send now
              </Button>
            )}
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => setEditing(body.text)}
            >
              <PencilIcon data-icon="inline-start" />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => onRemove(waiting)}
            >
              <XIcon data-icon="inline-start" />
              Remove
            </Button>
          </div>
        )}
      </MessageContent>
    </Message>
  )
}
