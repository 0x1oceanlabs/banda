/**
 * Files' tables (ADR 0073, decision 6): a CSV or a TSV as rows under a
 * header that stays, its columns as wide as their first rows need, its
 * numbers on the right; its source a toggle away. Its delimiter is
 * sniffed. The file is looked through once, in ranges of the file host,
 * for where its rows start, and only the rows in view are read again and
 * parsed, so a file of a million rows scrolls as one of ten.
 */
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { InHeader } from "@banda/ui/components/pane-header"
import { VirtualList } from "@banda/ui/components/virtual-list"
import { extensionOf } from "@banda/ui/lib/previewers"
import { cn } from "@banda/ui/lib/utils"
import { problem } from "@banda/ui/lib/words"
import type { PreviewProps } from "@banda/ui/module"
import { CodeIcon, FileWarningIcon } from "lucide-react"
import { Card, Loading } from "../Facts"
import { HeaderButton } from "../HeaderButton"
import {
  DELIMITER_NAMES,
  type Delimiter,
  numericColumns,
  parseRows,
  RowStarts,
  shownCell,
  sniff,
  widthsOf,
} from "../table"
import { countWords } from "../words"
import CodeView from "./code"
import { useRuns } from "./runs"

/** How much is read at once while the rows are found. */
const CHUNK = 1024 * 1024
/** How many rows are parsed together, and how many such runs are kept;
 * the first run sizes the columns. */
export const BLOCK_ROWS = 256
const BLOCK = BLOCK_ROWS
const KEPT = 64
/** A row's height, in px. */
const HEIGHT = 26
/** The most columns drawn. */
const MOST_COLUMNS = 500

export default function TableView(props: PreviewProps) {
  const { kept, keep } = props
  const source = kept.source === true
  return (
    <>
      <InHeader>
        <HeaderButton
          label="Source"
          on={source}
          onClick={() => keep({ ...kept, source: !source })}
        >
          <CodeIcon />
        </HeaderButton>
      </InHeader>
      {source ? <CodeView {...props} /> : <Csv {...props} />}
    </>
  )
}

/** Where the rows of a table start, as it is looked through. */
type Found =
  | { path: string; refused: string }
  | {
      path: string
      delimiter: Delimiter
      starts: RowStarts
      /** How far it has been looked through, 0 to 1. */
      done: number
    }

function Csv({ file, read }: PreviewProps) {
  const found = useRowStarts(file, read)
  const rows = useRows(found, read)
  if (found === null) return <Loading />
  if ("refused" in found)
    return (
      <Card
        icon={<FileWarningIcon />}
        title="This table cannot be read"
        note={found.refused}
      />
    )
  const { starts, delimiter, done } = found
  const count = starts.count
  if (count === 0 && done >= 1)
    return <Card icon={<FileWarningIcon />} title="This table is empty" />
  return (
    <Table
      label={file.name}
      count={count}
      row={rows.row}
      want={rows.want}
      first={rows.first}
      foot={
        <>
          <span>
            {countWords(Math.max(0, count - 1), "row")}
            {rows.first &&
              ` · ${countWords(rows.first[0]?.length ?? 0, "column")}`}
            {` · parted by ${DELIMITER_NAMES[delimiter]}`}
          </span>
          {done < 1 && (
            <span className="tabular-nums">
              Reading… {Math.floor(done * 100)}%
            </span>
          )}
          {starts.full && (
            <span>
              Only its first {countWords(starts.most - 1, "row")} are shown.
            </span>
          )}
        </>
      }
    />
  )
}

/** Where the rows of `file` start, found as it is read in chunks; the
 * last file's while the next is read. */
function useRowStarts(
  file: PreviewProps["file"],
  read: PreviewProps["read"]
): Found | null {
  const [found, setFound] = useState<Found | null>(null)
  const reader = useRef(read)
  useEffect(() => {
    reader.current = read
  })
  const { path, modified, size } = file
  const ready = file.url !== undefined
  useEffect(() => {
    if (!ready) return
    let gone = false
    const look = async () => {
      const whole = size ?? 0
      const chunk = (from: number) =>
        whole === 0
          ? Promise.resolve(new Uint8Array())
          : reader.current({ from, to: Math.min(whole, from + CHUNK) - 1 })
      const first = await chunk(0)
      if (gone) return
      const delimiter = sniff(
        new TextDecoder().decode(first.subarray(0, 64 * 1024)),
        extensionOf(path)
      )
      const starts = new RowStarts(delimiter)
      for (let from = 0, bytes = first; ;) {
        starts.push(bytes)
        from += bytes.length
        const done = whole === 0 || starts.full ? 1 : from / whole
        // A new object each time, so the table draws the rows found.
        setFound({ path, delimiter, starts, done })
        if (done >= 1 || bytes.length === 0) return
        bytes = await chunk(from)
        if (gone) return
      }
    }
    look().catch(
      (error: unknown) => gone || setFound({ path, refused: problem(error) })
    )
    return () => {
      gone = true
    }
  }, [path, modified, size, ready])
  return found
}

/** The rows of a table being shown: each parsed as a run of rows comes
 * into view, the runs read longest ago forgotten. */
function useRows(found: Found | null, read: PreviewProps["read"]) {
  const reader = useRef(read)
  useEffect(() => {
    reader.current = read
  })
  const starts = found && "starts" in found ? found.starts : null
  const delimiter = found && "starts" in found ? found.delimiter : ","
  const done = found && "done" in found ? found.done : 0
  // The runs parsed, for these starts: another file's are dropped.
  const blocks = useRuns<string[][]>(starts, KEPT)

  const want = useCallback(
    (first: number, last: number) => {
      if (!starts || !blocks.current) return
      const lastBlock = Math.floor((starts.count - 1) / BLOCK)
      // The first and the last runs stay: they size the columns.
      const stays = (block: number) => block === 0 || block === lastBlock
      for (
        let block = Math.floor(first / BLOCK);
        block <= Math.floor(last / BLOCK);
        block++
      ) {
        const end = Math.min(starts.count, (block + 1) * BLOCK) - 1
        // A run is read once all its rows are found.
        const whole = done >= 1 || (block + 1) * BLOCK < starts.count
        if (end < block * BLOCK || !whole) continue
        const from = starts.start(block * BLOCK)
        const to = starts.end(end) - 1
        const parse = async () =>
          parseRows(
            new TextDecoder().decode(
              to < from ? new Uint8Array() : await reader.current({ from, to })
            ),
            delimiter
          )
        blocks.want(block, parse, stays)
      }
    },
    // A new `found` brings more rows, which may finish a run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [found, blocks.want, blocks.current]
  )
  // The header and the first rows, and once all are found the last,
  // which size the columns: an id grows as the rows go on.
  const count = starts?.count ?? 0
  const lastBlock = done >= 1 && count > 0 ? Math.floor((count - 1) / BLOCK) : 0
  useEffect(() => {
    want(0, 0)
    if (lastBlock > 0) want(lastBlock * BLOCK, lastBlock * BLOCK)
  }, [want, lastBlock])
  const row = (index: number) =>
    blocks.get(Math.floor(index / BLOCK))?.[index % BLOCK]
  const head = blocks.get(0)
  const tail = lastBlock > 0 ? blocks.get(lastBlock) : undefined
  const sample = useMemo(
    () => (head ? (tail ? [...head, ...tail] : head) : null),
    [head, tail]
  )
  return { row, want, first: sample }
}

/** The width of a cell's text, in the table's font. */
function useMeasure(): (text: string) => number {
  return useMemo(() => {
    const context = document.createElement("canvas").getContext("2d")
    const family = getComputedStyle(document.body).fontFamily || "sans-serif"
    if (context) context.font = `12px ${family}`
    // Room for the cell's padding beside its text.
    return (text: string) =>
      (context ? context.measureText(text).width : text.length * 7) + 18
  }, [])
}

/**
 * Rows of cells under a header that stays, the first row's: a CSV's, or
 * a workbook's sheet. Only the rows in view are drawn; `row` gives each
 * once it is read, and `want` asks for those coming into view. `first`,
 * the first rows and maybe the last, sizes the columns; its first is the
 * header.
 */
export function Table({
  label,
  count,
  row,
  want,
  first,
  foot,
}: {
  label: string
  /** How many rows, the header's too. */
  count: number
  row: (index: number) => readonly string[] | undefined
  want: (first: number, last: number) => void
  first: readonly (readonly string[])[] | null
  foot: ReactNode
}) {
  const measure = useMeasure()
  const widths = useMemo(
    () => (first ? widthsOf(first, measure).slice(0, MOST_COLUMNS) : []),
    [first, measure]
  )
  const numeric = useMemo(() => (first ? numericColumns(first) : []), [first])
  // The row numbers' column, as wide as the last's.
  const numbers = Math.ceil(measure(String(count))) + 4
  const width = numbers + widths.reduce((sum, one) => sum + one, 0)
  const header = first?.[0] ?? []
  // The list's rows are the table's past its header.
  const wanted = useCallback(
    (from: number, to: number) => want(from + 1, to + 1),
    [want]
  )

  const cells = (
    cells: readonly string[] | undefined,
    head: boolean
  ): ReactNode =>
    widths.map((width, column) => {
      const text = cells?.[column] ?? ""
      return (
        <div
          key={column}
          role={head ? "columnheader" : "cell"}
          title={text.length > 24 || text.includes("\n") ? text : undefined}
          style={{ width }}
          className={cn(
            "shrink-0 truncate border-r border-border/50 px-2",
            numeric[column] && "text-right",
            numeric[column] && !head && "tabular-nums"
          )}
        >
          {shownCell(text)}
        </div>
      )
    })

  const line = (index: number, style: CSSProperties) => {
    const cellsOf = row(index + 1)
    return (
      <div
        role="row"
        aria-rowindex={index + 2}
        style={{ ...style, width }}
        className="flex items-center border-b border-border/40 hover:bg-muted/40"
      >
        <div
          role="rowheader"
          style={{ width: numbers }}
          className="sticky left-0 shrink-0 self-stretch bg-background pr-2 text-right leading-[26px] text-muted-foreground tabular-nums"
        >
          {index + 1}
        </div>
        {cellsOf ? (
          cells(cellsOf, false)
        ) : (
          <div className="px-2 text-muted-foreground/50">…</div>
        )}
      </div>
    )
  }

  if (!first) return <Loading />
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <VirtualList
        role="table"
        aria-label={label}
        aria-rowcount={count}
        tabIndex={0}
        count={Math.max(0, count - 1)}
        rowHeight={HEIGHT}
        width={width}
        row={line}
        onRange={wanted}
        header={
          <div
            role="row"
            aria-rowindex={1}
            style={{ width }}
            className="flex h-7 items-center border-b bg-background font-medium"
          >
            <div
              style={{ width: numbers }}
              className="sticky left-0 shrink-0 self-stretch bg-background"
            />
            {cells(header, true)}
          </div>
        }
        className="flex-1 text-xs outline-none select-text"
      />
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 border-t px-3 py-1 text-xs text-muted-foreground">
        {foot}
      </div>
    </div>
  )
}
