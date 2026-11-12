import { useContext, useLayoutEffect, useRef, useState } from "react"
import { Button } from "@banda/ui/components/button"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { cn } from "@banda/ui/lib/utils"
import {
  ArchiveRestoreIcon,
  CheckIcon,
  CircleDotIcon,
  CircleIcon,
  ClockIcon,
  type LucideIcon,
  XIcon,
} from "lucide-react"
import { refusalOf, setRefusalOf } from "./items"
import { keyId } from "./keys"
import { Bulk } from "./PickList"
import { actOnRow, type SetAct } from "./useActs"

/** One button of the bar: what it does, its words and icon, the key in
 * force that does the same, and why it does nothing, where it does not. */
type Tool = {
  does: SetAct | "clear"
  name: string
  icon: LucideIcon
  key?: string
  off?: string
}

/** The words of a button: its name, then its key, or why it does
 * nothing. */
const titleOf = ({ name, key, off }: Tool) =>
  off ?? (key ? `${name} (${key})` : name)

/**
 * The bar of the selection (ADR 0098, decision 15; spec S10b): over the
 * foot, at its height, while cards are checked, it says how many and
 * offers Archive, Later, Unread and ✕, each an icon whose tooltip names
 * it and its key in force, as `S`, `Z`, `U` and Esc do. Archive brings
 * back in the Archive; it, Later and Unread are `aria-disabled` and stay
 * in the Tab order where they would do nothing, their tooltip saying why:
 * "They ask you. Z puts them off." It is a `toolbar`, one Tab stop whose
 * buttons ←/→ walk. It comes with its opacity and a 4 px rise, and goes
 * with its opacity (`globals.css`); gone with the focus in it, it gives
 * the focus to the list. What it acts on and how, it reads (`Bulk`).
 */
export function BulkBar() {
  const { rows, onAct, onClear, list } = useContext(Bulk)
  const keyLabel = useKeyLabel()
  const shown = rows.length > 0
  // As it goes, it still says how many it had.
  const [count, setCount] = useState(rows.length)
  if (shown && count !== rows.length) setCount(rows.length)
  const bar = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState(0)
  useLayoutEffect(() => {
    if (!shown && bar.current?.contains(document.activeElement))
      list?.current?.focus({ preventScroll: true })
  }, [shown, list])

  const later = keyLabel(keyId("later"))
  const can = (act: SetAct) => rows.some((row) => actOnRow(row, act))
  // In the Archive, Archive brings back.
  const archived = shown && rows.every((row) => row.stand === "archived")
  const refusing = rows.filter((row) => refusalOf(row, undefined))
  const unread = rows.filter((row) => actOnRow(row, "unread"))
  const tools: Tool[] = [
    {
      does: "archive",
      name: archived ? "Unarchive" : "Archive",
      icon: archived ? ArchiveRestoreIcon : CheckIcon,
      key: keyLabel(keyId("archive")),
      ...(can("archive")
        ? {}
        : refusing.length === rows.length && refusing.length > 0
          ? { off: setRefusalOf(refusing, later) }
          : { off: "Nothing here to archive" }),
    },
    {
      does: "later",
      name: "Later",
      icon: ClockIcon,
      key: later,
      ...(can("later") ? {} : { off: "Archived Threads are not put off" }),
    },
    unread.some((row) => row.listed.seen) || unread.length === 0
      ? {
          does: "unread",
          name: "Mark as unread",
          icon: CircleDotIcon,
          key: keyLabel(keyId("unread")),
          ...(unread.length > 0
            ? {}
            : { off: "A question waits until it's answered." }),
        }
      : {
          does: "unread",
          name: "Mark as read",
          icon: CircleIcon,
          key: keyLabel(keyId("unread")),
        },
    {
      does: "clear",
      name: "Clear the selection",
      icon: XIcon,
      key: "Esc",
    },
  ]
  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label={`${count} selected`}
      data-bulk=""
      data-shown={shown ? "" : undefined}
      inert={!shown || undefined}
      className="absolute inset-x-1.5 top-0.5 bottom-1.5 flex items-center gap-0.5 rounded-control bg-foreground/7 pr-0.5 pl-2.5"
      onKeyDown={(event) => {
        const next =
          event.key === "ArrowRight"
            ? at + 1
            : event.key === "ArrowLeft"
              ? at - 1
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tools.length - 1
                  : undefined
        if (next === undefined) return
        event.preventDefault()
        const to = Math.max(0, Math.min(tools.length - 1, next))
        setAt(to)
        const buttons = bar.current?.querySelectorAll<HTMLElement>("button")
        buttons?.[to]?.focus({ preventScroll: true })
      }}
    >
      <span className="mr-auto truncate text-meta text-muted-foreground tabular-nums">
        {count} selected
      </span>
      {tools.map((tool, index) => {
        const { does, name, icon: Icon, off } = tool
        return (
          <Button
            key={does}
            variant="ghost"
            size="icon-xs"
            aria-label={name}
            aria-disabled={off ? true : undefined}
            title={titleOf(tool)}
            data-does={does}
            tabIndex={index === at ? 0 : -1}
            className={cn(
              "text-muted-foreground",
              off &&
                "opacity-50 hover:bg-transparent hover:text-muted-foreground"
            )}
            onFocus={() => setAt(index)}
            onClick={(event) => {
              if (off) return
              if (does === "clear") onClear()
              else onAct(does, event.currentTarget)
            }}
          >
            <Icon className="size-3.5" />
          </Button>
        )
      })}
    </div>
  )
}
