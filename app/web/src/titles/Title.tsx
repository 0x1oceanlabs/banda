import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import {
  DropdownMenu,
  DropdownMenuContent,
} from "@banda/ui/components/dropdown-menu"
import { toast } from "@banda/ui/components/sonner"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { cn } from "@banda/ui/lib/utils"
import { problem } from "@banda/ui/lib/words"
import { focusedTile, type Listed } from "@banda/ui/pane"
import { ChevronDownIcon, SparklesIcon } from "lucide-react"
import { ThreadRows } from "./ThreadMenu"
import {
  listingFor,
  type Naming,
  renameTo,
  startNaming,
  stopNaming,
  THINKING,
  useNaming,
  useThinking,
} from "./titles"

/** Why a menu closed, as Base UI says it. */
type Reason = string | undefined

/**
 * A listed thing's title in its Pane's header (ADR 0077): on a focused
 * Pane, a click opens the Thread menu under it, and the pointer over it
 * shows a quiet fill and a ▾; the first click on a Pane that is not
 * focused only focuses it, as anywhere on the header. A double click
 * opens the field in its place. The rest of the header keeps its own
 * gestures (ADR 0066, decision 4): the Pane is carried by its title too.
 */
export function Title({
  engine,
  project,
  listed,
  title,
  focused,
}: {
  engine: Engine
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
  const listing = listingFor(listed)
  const words = thinking ? THINKING : title
  if (!listing)
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
        engine={engine}
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
            startNaming(project, listed.id, "head")
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
            engine={engine}
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
 * The field that names a thing, where its title was (ADR 0077, decision
 * 1): its text all selected; Enter or a click elsewhere keeps it, Esc
 * leaves the old title, and an empty one gives back the title it had by
 * itself. Its ✨ puts the model's title in it, selected.
 */
export function TitleField({
  engine,
  project,
  listed,
  naming,
  className,
}: {
  engine: Engine
  project: ProjectId
  listed: Listed
  naming: Naming
  className?: string
}) {
  const keyFor = useKeyLabel()
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(listed.title)
  const [thinking, setThinking] = useState(false)
  const done = useRef(false)
  const listing = listingFor(listed)
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
    renameTo(engine, project, listed, input.current?.value ?? text)
    if (back) focusBack(before.current)
  }
  const cancel = () => {
    done.current = true
    stopNaming()
    focusBack(before.current)
  }
  const suggest = async () => {
    if (!listing?.suggest || thinking) return
    setThinking(true)
    try {
      const title = await listing.suggest(engine, project, listed.id)
      if (done.current) return
      setText(title)
      requestAnimationFrame(() => {
        input.current?.focus()
        input.current?.select()
      })
    } catch (error) {
      toast.error(problem(error))
    } finally {
      setThinking(false)
    }
  }
  // `Shift+F2` while it is open asks as its ✨ does.
  const asked = useRef(naming.asked)
  useEffect(() => {
    if (naming.asked === asked.current) return
    asked.current = naming.asked
    void suggest()
  })
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
      {listing?.suggest && (
        <button
          type="button"
          aria-label="Suggest a title"
          title={keyFor("thread.suggest-title", "Suggest a title")}
          className={cn(
            "mr-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/8 hover:text-foreground",
            thinking && "animate-pulse text-foreground"
          )}
          // The field keeps the focus, so it stays open.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void suggest()}
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
