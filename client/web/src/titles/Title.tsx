import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { ProjectId } from "@banda/contract"
import {
  DropdownMenu,
  DropdownMenuContent,
} from "@banda/ui/components/dropdown-menu"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import {
  type Naming,
  stopNaming,
  THINKING,
  useNaming,
  useThinking,
} from "@banda/ui/lib/naming"
import { cn } from "@banda/ui/lib/utils"
import { focusedTile, type Listed } from "@banda/ui/pane"
import { ChevronDownIcon, SparklesIcon } from "lucide-react"
import { itemActionOf } from "../sidebar/items"
import { ThreadRows, useItemRun } from "./ThreadMenu"

/** Why a menu closed, as Base UI says it. */
type Reason = string | undefined

/**
 * A listed thing's title in its Pane's header (ADR 0077): on a focused
 * Pane, a click opens the Thread menu under it, and the pointer over it
 * shows a quiet fill and a ▾; the first click on a Pane that is not
 * focused only focuses it, as anywhere on the header. A double click
 * opens the field in its place, as its App's Rename does (ADR 0087,
 * decision 12). The rest of the header keeps its own gestures (ADR 0066,
 * decision 4): the Pane is carried by its title too.
 */
export function Title({
  project,
  listed,
  title,
  focused,
}: {
  project: ProjectId
  listed: Listed
  /** The title as the Pane says it now. */
  title: string
  focused: boolean
}) {
  const naming = useNaming(project, listed.id, "head")
  const thinking = useThinking(project, listed.id)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLHeadingElement>(null)
  // What a press found, before it focused the Pane or closed the menu.
  const pressed = useRef({ at: -1, open: false })
  // When the Pane took the focus: a press that gave it the focus may have
  // drawn it focused already, before its click.
  const focusedAt = useRef(Infinity)
  useLayoutEffect(() => {
    focusedAt.current = focused ? performance.now() : Infinity
  }, [focused])
  const before = useRef<HTMLElement | null>(null)
  const reason = useRef<Reason>(undefined)
  const next = useRef<() => void>(undefined)
  const run = useItemRun()
  const rename = itemActionOf(listed, "rename")
  const words = thinking ? THINKING : title
  if (!rename)
    return (
      <h2 className="min-w-0 truncate font-medium text-muted-foreground group-data-[selected=true]/tile:text-foreground">
        {title}
      </h2>
    )
  // On a focused Pane only: a field that is open in another Pane's header
  // stays that one's.
  if (naming && focused)
    return (
      <TitleField
        project={project}
        listed={listed}
        naming={naming}
        className="max-w-md"
      />
    )
  return (
    <>
      <h2
        ref={anchor}
        className="-ml-1 flex h-6 min-w-0 shrink items-center rounded-md pr-0.5 pl-1 font-medium text-muted-foreground transition-colors group-data-[selected=true]/tile:text-foreground group-data-[focused=true]/tile:hover:bg-foreground/6 data-open:bg-foreground/6"
        data-open={open || undefined}
      >
        <span
          role="button"
          tabIndex={-1}
          aria-haspopup="menu"
          aria-expanded={open}
          className="group/title flex min-w-0 items-center gap-0.5 outline-none"
          // The focus stays where it is, as in the composer.
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            pressed.current = { at: event.timeStamp, open }
            if (!open) before.current = document.activeElement as HTMLElement
          }}
          onClick={() => {
            // The first click on a Pane not focused only focuses it; a
            // click on the open menu's title closed it as it went down.
            const { at, open: wasOpen } = pressed.current
            pressed.current = { at: -1, open: false }
            const was = at >= 0 && focusedAt.current < at
            if (was && !wasOpen) setOpen(true)
          }}
          onDoubleClick={(event) => {
            // Its own, not the header's: the column stays as wide.
            event.stopPropagation()
            // The field takes the focus, not what the menu had.
            reason.current = "outside-press"
            setOpen(false)
            run(rename.id, { project, item: listed.id, from: "head" })
          }}
        >
          <span data-shimmer={thinking || undefined} className="truncate">
            {words}
          </span>
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-data-[focused=true]/tile:group-hover/title:opacity-100",
              open && "opacity-100"
            )}
          />
        </span>
      </h2>
      <DropdownMenu
        open={open}
        modal={false}
        onOpenChange={(now, details) => {
          reason.current = details.reason
          setOpen(now)
        }}
        onOpenChangeComplete={(now) => {
          if (now) return
          const act = next.current
          next.current = undefined
          act?.()
        }}
      >
        <DropdownMenuContent
          anchor={anchor}
          aria-label="Thread menu"
          className="w-auto min-w-60"
          // A press elsewhere put the focus where it went; else it goes
          // back where it was, as into the composer.
          finalFocus={() =>
            reason.current === "outside-press"
              ? false
              : (before.current ?? true)
          }
        >
          <ThreadRows
            project={project}
            listed={listed}
            where="head"
            later={(act) => {
              next.current = act
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

/**
 * The field that names an Item, where its title was (ADR 0077, decision
 * 1): its text all selected; Enter or a click elsewhere keeps it, Esc
 * leaves the old title, and an empty one gives back the title it had by
 * itself. Its ✨ puts the model's title in it, selected. Its App's item
 * actions rename and suggest (ADR 0087, decision 12).
 */
export function TitleField({
  project,
  listed,
  naming,
  className,
}: {
  project: ProjectId
  listed: Listed
  naming: Naming
  className?: string
}) {
  const keyFor = useKeyLabel()
  const run = useItemRun()
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(listed.title)
  const done = useRef(false)
  const rename = itemActionOf(listed, "rename")
  const suggest = itemActionOf(listed, "suggest")
  const thinking = naming.asking
  // Where the focus was, as the composer, for Enter and Esc to give it
  // back; a click elsewhere puts it where it went.
  const before = useRef<Element | null>(null)
  useLayoutEffect(() => {
    before.current = document.activeElement
    input.current?.focus()
    input.current?.select()
  }, [])
  const keep = (back = false) => {
    if (done.current) return
    done.current = true
    stopNaming()
    const title = input.current?.value ?? text
    if (rename) run(rename.id, { project, item: listed.id, title })
    if (back) focusBack(before.current)
  }
  const cancel = () => {
    done.current = true
    stopNaming()
    focusBack(before.current)
  }
  // The title the model offered, as its ✨ or `Shift+F2` asked, goes in
  // the field, selected.
  const { offered } = naming
  const [took, setTook] = useState(offered)
  if (offered !== took) {
    setTook(offered)
    if (offered) setText(offered.title)
  }
  useEffect(() => {
    if (!offered) return
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.select()
    })
  }, [offered])
  return (
    <span
      className={cn(
        "relative flex h-6 min-w-40 flex-1 items-center rounded-md bg-background ring-1 ring-ring/60",
        className
      )}
    >
      <input
        ref={input}
        aria-label="Title"
        value={text}
        maxLength={120}
        spellCheck={false}
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent pr-1 pl-1.5 font-medium text-foreground outline-none",
          thinking && "text-transparent"
        )}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            keep(true)
          } else if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            cancel()
          }
        }}
        onBlur={() => keep()}
        // Nothing of the header's: it is not carried, not made wide.
        onDoubleClick={(event) => event.stopPropagation()}
      />
      {thinking && (
        <span
          data-shimmer=""
          className="pointer-events-none absolute inset-y-0 left-1.5 flex items-center text-xs"
        >
          {THINKING}
        </span>
      )}
      {suggest && (
        <button
          type="button"
          aria-label="Suggest a title"
          title={keyFor(suggest.id, "Suggest a title")}
          className={cn(
            "mr-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/8 hover:text-foreground",
            thinking && "animate-pulse text-foreground"
          )}
          // The field keeps the focus, so it stays open.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => run(suggest.id, { project, item: listed.id })}
        >
          <SparklesIcon className="size-3.5" />
        </button>
      )}
    </span>
  )
}

/** Gives the focus back to `element`, else to the focused Pane, once the
 * field has gone. */
function focusBack(element: Element | null) {
  requestAnimationFrame(() => {
    const to =
      element instanceof HTMLElement && element.isConnected
        ? element
        : focusedTile()
    to?.focus({ preventScroll: true })
  })
}
