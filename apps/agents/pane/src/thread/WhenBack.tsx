/**
 * A message to a started Thread whose machine is away, stopped or on
 * another build waits for it (ADR 0105): Send reads "Send when back", the
 * message shows at the end of the Thread until it goes, and one that does
 * not go in its time comes back into the draft, with a toast that says
 * why. The queue is the Window's (`WindowApi.waiting`); these are the
 * agents module's words for it, and what it does with what comes back.
 */
import { useEffect, useRef, useState } from "react"
import type { Image } from "@banda/contract/agents"
import { Bubble, BubbleContent } from "@banda/ui/components/bubble"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { Message, MessageContent } from "@banda/ui/components/message"
import { cn } from "@banda/ui/lib/utils"
import {
  type Back,
  clock,
  KEEP,
  KEEPS,
  type Wait,
  type Why,
} from "@banda/core/react"
import { toast } from "@banda/ui/components/sonner"
import type { WindowApi } from "@banda/ui/module"
import { CircleAlertIcon, ClockIcon } from "lucide-react"
import { putBack } from "../composer/drafts"
import { type ImageReader, MessageImages } from "../entries/parts/MessageImages"
import { THREAD_ZOOM } from "../entries/parts/Messages"
import { Action, EditWaiting } from "./Queue"

/** What a Person does with a message that waits for its machine. */
export type WhenBackActions = {
  /** Takes it back, its words and images into the draft. */
  onCancel: (wait: Wait) => void
  /** Changes its words; it keeps its time. One that went meanwhile leaves
   * the words typed in the draft. */
  onEdit: (wait: Wait, text: string) => void
  /** Holds it while its row is edited, so it neither goes nor comes back
   * meanwhile; returns how to let it go. */
  onHold: (wait: Wait) => () => void
  /** Keeps it for `keep` ms from when Send was pressed. */
  onKeepFor: (wait: Wait, keep: number) => void
}

/**
 * The messages that wait for the Thread's machine, at its end, in the
 * look of its Queue (ADR 0105, Q3): each dashed and dim, with when it gives
 * up, which opens "Keep for", as a right click on it does (Q4), then Edit
 * and Cancel. One that may have gone through as its machine went says so,
 * with neither Edit nor Keep for, as it goes again as it is.
 */
export function WaitsFor({
  waits,
  machine,
  reader,
  ...actions
}: WhenBackActions & {
  waits: readonly Wait[]
  machine: string
  reader: ImageReader
}) {
  return (
    <ul aria-label={`Waiting for ${machine}`} className="flex flex-col gap-3">
      {waits.map((wait) => (
        <li key={wait.call.command}>
          <WaitFor wait={wait} machine={machine} reader={reader} {...actions} />
        </li>
      ))}
    </ul>
  )
}

/** The messages that wait, where the Thread is not read yet, as its
 * machine is away: at its end, with nothing above them but why, where it
 * was refused (ADR 0105, Q3; the mock's frame 6). */
export function WaitsAlone({
  why,
  children,
}: {
  why?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        {why && <p className="text-ui text-muted-foreground">{why}</p>}
      </div>
      <div
        data-chat
        className="mx-auto w-full max-w-3xl px-(--chat-gutter) pt-4 pb-6"
      >
        {children}
      </div>
    </div>
  )
}

function WaitFor({
  wait,
  machine,
  reader,
  onCancel,
  onEdit,
  onHold,
  onKeepFor,
}: WhenBackActions & { wait: Wait; machine: string; reader: ImageReader }) {
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState(false)
  // Held while it is edited, so what goes is what is typed; let go as
  // the editor closes, or the row goes.
  const letGo = useRef<() => void>(undefined)
  useEffect(() => () => letGo.current?.(), [])
  const edit = (open: boolean) => {
    letGo.current?.()
    letGo.current = open ? onHold(wait) : undefined
    setEditing(open)
  }
  const row = rowOf(wait)
  return (
    <Message align="end">
      <MessageContent>
        {/* Its own menu, not the Thread's. */}
        <div
          className="contents"
          onContextMenu={(event) => {
            if (!row.keepFor || editing) return
            event.preventDefault()
            event.stopPropagation()
            setMenu(true)
          }}
        >
          <MessageImages images={imagesOf(wait)} reader={reader} />
          {editing ? (
            <EditWaiting
              text={wait.text}
              busy={false}
              onSave={async (text) => {
                // Emptied, with no image to carry, it keeps its words.
                if (text.trim() !== "" || imagesOf(wait).length > 0)
                  onEdit(wait, text)
                edit(false)
              }}
              onCancel={() => edit(false)}
            />
          ) : (
            row.text && (
              <Bubble
                variant="outline"
                align="end"
                className={cn("text-muted-foreground", THREAD_ZOOM)}
              >
                <BubbleContent className="border-dashed whitespace-pre-wrap">
                  {row.text}
                </BubbleContent>
              </Bubble>
            )
          )}
        </div>
        {!editing && (
          <div className="-mt-1.5 flex items-center justify-end gap-3 text-meta whitespace-nowrap text-muted-foreground tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <ClockIcon className="size-3" />
              <span>
                Waits for {machine} ·{" "}
                {row.keepFor ? (
                  <KeepFor
                    wait={wait}
                    says={row.says}
                    open={menu}
                    onOpenChange={setMenu}
                    onKeepFor={onKeepFor}
                  />
                ) : (
                  row.says
                )}
              </span>
            </span>
            {row.edit && <Action onClick={() => edit(true)}>Edit</Action>}
            <Action disabled={!row.cancel} onClick={() => onCancel(wait)}>
              Cancel
            </Action>
          </div>
        )}
      </MessageContent>
    </Message>
  )
}

/** When a message gives up, "until 14:42", which opens how long it is
 * kept: from when Send was pressed, 7 days at most. */
function KeepFor({
  wait,
  says,
  open,
  onOpenChange,
  onKeepFor,
}: Pick<WhenBackActions, "onKeepFor"> & {
  wait: Wait
  says: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Action
            title="Keep for…"
            className="-mx-1 -my-px rounded-small px-1 py-px transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-muted data-popup-open:text-foreground"
          />
        }
      >
        {says}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-auto min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Keep for</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={wait.until - wait.at}
            onValueChange={(keep: number) => onKeepFor(wait, keep)}
          >
            {KEEPS.map((keep) => (
              <DropdownMenuRadioItem
                key={keep.for}
                value={keep.for}
                closeOnClick
              >
                {keep.words}
                {keep.for === KEEP && (
                  <DropdownMenuShortcut className="tracking-normal">
                    default
                  </DropdownMenuShortcut>
                )}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * What the row of message `wait` says and offers, as it stands: its words,
 * over its images; when it gives up, which opens Keep for; Edit; and
 * Cancel, which takes it back. One that may have gone through says so,
 * with Cancel alone, as it goes again as it is; one on its way offers
 * none.
 */
export function rowOf(wait: Wait) {
  // Only one neither on its way nor gone once changes.
  const changes = !wait.going && !wait.went
  return {
    text: wait.text,
    says: wait.went ? "may have gone through" : `until ${timeOf(wait.until)}`,
    keepFor: changes,
    edit: changes,
    cancel: !wait.going,
  }
}

/** The images message `wait` carries, as the agents module queued it. */
export const imagesOf = (wait: Wait) => (wait.carried ?? []) as Image[]

/** When a message gives up, in the words of the core's `clock()` by 24
 * hours, as its machine's label says what its rows are as of: "14:42",
 * "Wed 14:32", "Nov 17, 14:32". */
const timeOf = (at: number, now?: number) => clock(at, now, { hours: 24 })

/** Send's tooltip while it waits for `machine`: what it does, until when,
 * and its key. */
export const whenBackTitle = (machine: string, until: number, now: number) =>
  `Sends once ${machine} is back, until ${timeOf(until, now)} ↵`

/** What a toast says of a message that came back from `machine`, which
 * waited until `until`. */
export function backWords(why: Why, machine: string, until: number): string {
  switch (why.kind) {
    case "expired":
      return `Not sent: ${machine} was still away at ${timeOf(until)}.`
    case "went":
      return `${machine} went away; your message may have gone through.`
    case "refused":
      return `Not sent: ${why.message}`
  }
}

/** Puts a message that came back into its Thread's draft, its words and
 * its images, and says why in a toast; with `open`, which goes to its
 * Thread, where that Thread is not on screen. */
export function tellBack({ wait, why, machine }: Back, open?: () => void) {
  putBack(wait.item, wait.text, imagesOf(wait))
  // Quiet, not an error: nothing of the Agent's failed.
  toast(backWords(why, machine, wait.until), {
    icon: <CircleAlertIcon className="size-4 text-muted-foreground" />,
    ...(open && { action: { label: "Open", onClick: open } }),
  })
}

/** Hears, for the Window, what comes back to the agents module: each
 * message to a Thread, told of with Open unless its Thread is the Pane in
 * focus, as Here says. Returns how to stop. */
export function hearBack(window: WindowApi): () => void {
  return window.waiting.onBack((back) => {
    const { pane, project, item } = back.wait
    if (pane.kind !== "agents.thread") return false
    const at = window.here.get().pane
    const here = at?.project === project && at.subject === item
    tellBack(
      back,
      here ? undefined : () => window.run("pane.pick", { project, pane })
    )
    return true
  })
}
