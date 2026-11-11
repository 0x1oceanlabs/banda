/**
 * Files' Columns (ADR 0073, step F6), Miller columns as a Finder's: each
 * folder from the Pane's to the pick a column, the folder open in the next
 * lit in its own; a file picked shows in a last column, drawn by its
 * previewer in quick mode, or its info where none draws it. ↑ ↓ move in a
 * column, → goes into the folder picked, ← back out to its folder; the
 * newest column is scrolled into view.
 */
import { type ReactNode, type Ref, useLayoutEffect, useRef } from "react"
import type { Entry } from "@banda/contract/files"
import { FileIcon } from "@banda/ui/components/file-icon"
import type { FolderTreeHandle } from "@banda/ui/components/file-tree"
import { Spinner } from "@banda/ui/components/spinner"
import { cn } from "@banda/ui/lib/utils"
import { ChevronRightIcon, FolderIcon } from "lucide-react"
import type { Listed, Showing } from "./tree"
import {
  pulseStyle,
  RenameField,
  type Renaming,
  RowMark,
  type RowMarks,
  rowName,
  rowProps,
  useDrop,
  useView,
  type ViewEvents,
} from "./ViewParts"
import { columnsOf, itemsIn, parentRow, rowsIn } from "./views"

export function Columns({
  ref,
  label,
  top,
  listed,
  showing,
  loading,
  picked,
  marks,
  aside,
  ...events
}: ViewEvents & {
  ref?: Ref<FolderTreeHandle>
  label: string
  /** The name of the Pane's folder, the first column's. */
  top: string
  listed: Listed
  showing: Showing
  /** The folders being listed. */
  loading: ReadonlySet<string>
  picked: string | null
  marks: RowMarks
  /** What the last column shows of the file picked. */
  aside: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const { renaming, renamed, onKeyDown } = useView({
    ref,
    box,
    view: "columns",
    picked,
    rows: (folder) => rowsIn(listed, folder, showing),
    ...events,
  })
  const columns = columnsOf(picked)
  const file = picked !== null && !picked.endsWith("/")

  // The newest column, and the pick in each, in view; and the newest
  // again as the Pane is sized.
  useLayoutEffect(() => {
    const own = box.current
    if (!own) return
    own.scrollTo({ left: own.scrollWidth, behavior: "smooth" })
    const row = own.querySelector<HTMLElement>("[aria-selected=true]")
    row?.scrollIntoView({ block: "nearest" })
  }, [picked, columns.length])
  useLayoutEffect(() => {
    const own = box.current
    if (!own) return
    const sized = new ResizeObserver(() => {
      own.scrollLeft = own.scrollWidth
    })
    sized.observe(own)
    return () => sized.disconnect()
  }, [])

  return (
    <div
      ref={box}
      role="group"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={picked ? idOf(picked) : undefined}
      onKeyDown={onKeyDown}
      className="flex h-full min-w-0 overflow-x-auto overflow-y-hidden outline-none"
    >
      {columns.map((folder, n) => (
        <Column
          key={folder}
          folder={folder}
          label={folder ? rowName(folder) : top}
          items={itemsIn(listed, folder, showing)}
          open={columns[n + 1] ?? null}
          loading={loading.has(folder)}
          picked={picked}
          marks={marks}
          renaming={renaming}
          onRenamed={renamed}
          events={events}
        />
      ))}
      {file && (
        <div
          aria-label="Preview"
          className="flex min-w-56 flex-1 shrink-0 flex-col"
        >
          {aside}
        </div>
      )}
    </div>
  )
}

/** A row's id, for the view's `aria-activedescendant`. */
const idOf = (row: string) => `files-column-${encodeURIComponent(row)}`

function Column({
  folder,
  label,
  items,
  open,
  loading,
  picked,
  marks,
  renaming,
  onRenamed,
  events,
}: {
  folder: string
  label: string
  items: readonly { row: string; entry: Entry }[]
  /** The folder shown in the next column. */
  open: string | null
  loading: boolean
  picked: string | null
  marks: RowMarks
  renaming: Renaming
  onRenamed: (name: string | null) => void
  events: ViewEvents
}) {
  const [over, drop] = useDrop(folder, events.onDrop)
  return (
    <div
      role="listbox"
      aria-label={label}
      {...drop}
      className={cn(
        "flex w-48 shrink-0 flex-col gap-px overflow-y-auto border-r p-1",
        over && "bg-ring/10"
      )}
    >
      {items.map(({ row, entry }) => (
        <Row
          key={row}
          row={row}
          picked={row === picked}
          open={row === open}
          ignored={entry.ignored === true}
          marks={marks}
          renaming={renaming?.row === row ? renaming : null}
          onRenamed={onRenamed}
          events={events}
        />
      ))}
      {loading ? (
        <Spinner className="m-2 size-3.5 text-muted-foreground" />
      ) : (
        items.length === 0 && (
          <p className="px-2 py-1.5 text-meta text-muted-foreground">Empty</p>
        )
      )}
    </div>
  )
}

function Row({
  row,
  picked,
  open,
  ignored,
  marks,
  renaming,
  onRenamed,
  events,
}: {
  row: string
  picked: boolean
  open: boolean
  ignored: boolean
  marks: RowMarks
  renaming: Renaming
  onRenamed: (name: string | null) => void
  events: ViewEvents
}) {
  const folder = row.endsWith("/")
  const [over, drop] = useDrop(folder ? row : parentRow(row), events.onDrop)
  const colour = marks.pulses.get(row)
  return (
    <div
      id={idOf(row)}
      role="option"
      aria-selected={picked}
      aria-label={rowName(row)}
      {...rowProps(row, events)}
      {...(folder ? drop : {})}
      data-pulse={colour ? "" : undefined}
      style={pulseStyle(colour)}
      className={cn(
        "flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded-control px-1.5 text-xs",
        picked
          ? "bg-foreground/12"
          : open
            ? "bg-foreground/7"
            : "hover:bg-foreground/5",
        ignored && "text-muted-foreground",
        over && "bg-ring/20"
      )}
    >
      {folder ? (
        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <FileIcon path={row} className="text-muted-foreground" />
      )}
      {renaming ? (
        <RenameField
          name={rowName(row)}
          whole={renaming.whole}
          onDone={onRenamed}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{rowName(row)}</span>
      )}
      <RowMark row={row} marks={marks} />
      {folder && (
        <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
      )}
    </div>
  )
}
