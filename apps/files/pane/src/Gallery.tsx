/**
 * Files' Gallery (ADR 0073, step F6), as a Finder's: the row picked big,
 * drawn by its previewer in quick mode, over a filmstrip of what its folder
 * holds, each with its small picture (`files.thumb`) or its icon. ← → move
 * along the filmstrip, Home and End to its ends; only the filmstrip's items in
 * view are drawn and pictured, so a folder of thousands is quick. With
 * nothing picked, its first row is.
 */
import {
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { Entry } from "@banda/contract/files"
import { FileIcon } from "@banda/ui/components/file-icon"
import type { FolderTreeHandle } from "@banda/ui/components/file-tree"
import { cn } from "@banda/ui/lib/utils"
import { FolderIcon } from "lucide-react"
import type { Listed, Showing } from "./tree"
import { useThumb } from "./thumbs"
import {
  pulseStyle,
  RenameField,
  type Renaming,
  type RowMarks,
  rowName,
  rowProps,
  useDrop,
  useView,
  type ViewEvents,
} from "./ViewParts"
import {
  FILM,
  filmScroll,
  filmWindow,
  itemsIn,
  parentRow,
  rowsIn,
} from "./views"
import { wholeOf } from "./where"

/** How big an item's picture is drawn, in px. */
const PICTURE = { width: 70, height: 54 }

export function Gallery({
  ref,
  label,
  engine,
  project,
  dir,
  listed,
  showing,
  picked,
  marks,
  big,
  ...events
}: ViewEvents & {
  ref?: Ref<FolderTreeHandle>
  label: string
  engine: Engine
  project: ProjectId
  /** The Pane's folder, whole. */
  dir: string
  listed: Listed
  showing: Showing
  picked: string | null
  marks: RowMarks
  /** What shows big of the row picked. */
  big: ReactNode
}) {
  const film = useRef<HTMLDivElement>(null)
  const { renaming, renamed, onKeyDown } = useView({
    ref,
    box: film,
    view: "gallery",
    picked,
    rows: (of) => rowsIn(listed, of, showing),
    ...events,
  })
  const folder = picked === null ? "" : parentRow(picked)
  const items = itemsIn(listed, folder, showing)
  const at = picked === null ? -1 : items.findIndex(({ row }) => row === picked)

  // With nothing picked, its first row is.
  const first = items[0]?.row
  const { onSelect } = events
  useEffect(() => {
    if (picked === null && first !== undefined) onSelect(first)
  }, [picked, first, onSelect])

  // Only the items in view are drawn; the pick is kept in view.
  const [view, setView] = useState({ scroll: 0, width: 0 })
  useLayoutEffect(() => {
    const own = film.current
    if (!own) return
    const measure = () =>
      setView({ scroll: own.scrollLeft, width: own.clientWidth })
    measure()
    const sizes = new ResizeObserver(measure)
    sizes.observe(own)
    return () => sizes.disconnect()
  }, [])
  useLayoutEffect(() => {
    const own = film.current
    if (!own || at < 0) return
    const to = filmScroll(at, own.scrollLeft, own.clientWidth)
    if (to !== own.scrollLeft) own.scrollLeft = to
  }, [at])
  const { from, to } = filmWindow({
    count: items.length,
    scroll: view.scroll,
    width: view.width,
  })
  const [over, drop] = useDrop(folder, events.onDrop)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col border-b">{big}</div>
      <div
        ref={film}
        role="listbox"
        aria-label={label}
        aria-orientation="horizontal"
        tabIndex={0}
        aria-activedescendant={picked ? idOf(picked) : undefined}
        onScroll={(event) =>
          setView({
            scroll: event.currentTarget.scrollLeft,
            width: event.currentTarget.clientWidth,
          })
        }
        onKeyDown={onKeyDown}
        {...drop}
        className={cn(
          "relative h-24 shrink-0 overflow-x-auto overflow-y-hidden outline-none",
          over && "bg-ring/10"
        )}
      >
        <div
          className="relative h-full"
          style={{ width: items.length * (FILM.item + FILM.gap) + FILM.gap }}
        >
          {items.slice(from, to).map(({ row, entry }, n) => (
            <Item
              key={row}
              row={row}
              left={FILM.gap + (from + n) * (FILM.item + FILM.gap)}
              engine={engine}
              project={project}
              whole={wholeOf(dir, row)}
              entry={entry}
              picked={row === picked}
              marks={marks}
              renaming={renaming?.row === row ? renaming : null}
              onRenamed={renamed}
              events={events}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** An item's id, for the filmstrip's `aria-activedescendant`. */
const idOf = (row: string) => `files-film-${encodeURIComponent(row)}`

function Item({
  row,
  left,
  engine,
  project,
  whole,
  entry,
  picked,
  marks,
  renaming,
  onRenamed,
  events,
}: {
  row: string
  left: number
  engine: Engine
  project: ProjectId
  whole: string
  entry: Entry
  picked: boolean
  marks: RowMarks
  renaming: Renaming
  onRenamed: (name: string | null) => void
  events: ViewEvents
}) {
  const folder = row.endsWith("/")
  const picture = useThumb(
    engine,
    project,
    folder ? null : { path: whole, modified: entry.modified, size: entry.size },
    PICTURE.width
  )
  const [over, drop] = useDrop(row, events.onDrop)
  const colour = marks.pulses.get(row)
  return (
    <div
      id={idOf(row)}
      role="option"
      aria-selected={picked}
      aria-label={rowName(row)}
      {...rowProps(row, events)}
      {...(folder ? drop : {})}
      style={{ left, width: FILM.item }}
      className={cn(
        "absolute top-2 flex cursor-default flex-col items-center gap-1 rounded-control p-1",
        picked ? "bg-foreground/12" : "hover:bg-foreground/5",
        entry.ignored && "opacity-55",
        over && "bg-ring/20"
      )}
    >
      <div
        data-pulse={colour ? "" : undefined}
        style={{ ...pulseStyle(colour), ...PICTURE }}
        className="flex items-center justify-center overflow-hidden rounded-control bg-foreground/6 text-muted-foreground"
      >
        {picture ? (
          <img
            src={picture}
            alt=""
            draggable={false}
            className="size-full object-cover"
          />
        ) : folder ? (
          <FolderIcon className="size-6 stroke-[1.5]" />
        ) : (
          <FileIcon path={row} className="size-6" />
        )}
      </div>
      {renaming ? (
        <RenameField
          name={rowName(row)}
          whole={renaming.whole}
          onDone={onRenamed}
        />
      ) : (
        <span className="max-w-full truncate text-[10.5px] text-muted-foreground">
          {rowName(row)}
        </span>
      )}
    </div>
  )
}
