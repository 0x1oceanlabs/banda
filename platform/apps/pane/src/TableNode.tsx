/** A Table of an App's screen: rows by column, found, ordered and paged
 * here, with what can be done with each row. */
import type { TreeAction, TreeColumn, TreeTable } from "@banda/contract/apps"
import { Badge } from "@banda/ui/components/badge"
import { Button } from "@banda/ui/components/button"
import { Input } from "@banda/ui/components/input"
import { clamp, Progress } from "@banda/ui/components/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@banda/ui/components/table"
import { cn } from "@banda/ui/lib/utils"
import { ArrowDownIcon, ArrowUpIcon, CheckIcon } from "lucide-react"
import { useContext, useMemo, useState } from "react"
import { ActButton, ActMenu } from "./Act"
import type { Send } from "./Fields"
import { Opening } from "./nav"
import { FRAME, Nothing } from "./frame"
import {
  type Cell,
  found,
  nextOrder,
  opensWith,
  type Order,
  ordered,
  PAGE,
  type Row,
  taken,
  wordsOf,
} from "./rows"
import { toneBadge } from "./tone"

/** Whether a column holds numbers only, which read from the right. */
function numeric(table: TreeTable, column: TreeColumn): boolean {
  const cells = table.rows.map((row) => row[column.key] ?? null)
  return (
    cells.some((cell) => typeof cell === "number") &&
    cells.every((cell) => cell === null || typeof cell === "number")
  )
}

function CellView({ cell, column }: { cell: Cell; column: TreeColumn }) {
  if (column.as === "check")
    return cell === true ? (
      <CheckIcon aria-label="Yes" className="inline size-4" />
    ) : null
  if (cell === null || cell === undefined || cell === "")
    return <span className="text-muted-foreground">—</span>
  const words = wordsOf(cell)
  if (column.as === "badge")
    return (
      <Badge variant="outline" className={toneBadge(column.tones?.[words])}>
        {words}
      </Badge>
    )
  if (column.as === "progress" && typeof cell === "number")
    return (
      <span className="flex items-center gap-2">
        <Progress value={cell} aria-label={column.title} className="w-20" />
        <span className="tabular-nums">{clamp(cell)}</span>
      </span>
    )
  return words
}

/** How many of a row's actions are buttons when a menu holds the rest. */
const SHOWN = 2

/**
 * What can be done with a row: up to three as buttons, and of more, the
 * first two as buttons with the rest under a menu, so a row's actions
 * never push its columns out.
 */
function RowActions({
  actions,
  row,
  send,
}: {
  actions: readonly TreeAction[]
  row: Row
  send: Send
}) {
  const doings = actions.map((action) => {
    const { sent, given } = taken(action, row)
    return { doing: { ...action, params: sent }, given }
  })
  const shown = doings.length > SHOWN + 1 ? doings.slice(0, SHOWN) : doings
  const rest = doings.slice(shown.length)
  return (
    <div className="flex justify-end gap-1">
      {shown.map(({ doing, given }, place) => (
        <ActButton
          key={place}
          doing={doing}
          given={given}
          send={send}
          variant="ghost"
          size="xs"
        />
      ))}
      {rest.length > 0 && <ActMenu doings={rest} send={send} />}
    </div>
  )
}

export function TableNode({ table, send }: { table: TreeTable; send: Send }) {
  const [query, setQuery] = useState("")
  const [order, setOrder] = useState<Order>()
  const [page, setPage] = useState(0)
  const actions = table.actions ?? []
  const opening = useContext(Opening)
  // A click on a row opens its view, where the App named one.
  const opens = table.open && opening ? table.open : undefined
  // Each row with its place among those the App wrote: a row is the
  // same one however they are ordered. Typing in Find orders nothing.
  const places = useMemo(
    () => new Map(table.rows.map((row, place) => [row, place])),
    [table]
  )
  const inOrder = useMemo(() => ordered(table.rows, order), [table, order])
  const rows = useMemo(
    () => found(inOrder, table.columns, query),
    [inOrder, table, query]
  )
  const right = useMemo(
    () =>
      table.columns.map(
        (column) => column.as === "badge" || numeric(table, column)
      ),
    [table]
  )
  if (table.rows.length === 0 && table.empty)
    return <Nothing title={table.empty} />
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  // The rows may have gone from under the page it was on.
  const at = Math.min(page, pages - 1)
  const shown = rows.slice(at * PAGE, (at + 1) * PAGE)
  return (
    <div data-slot="tree-table" className="flex flex-col gap-2">
      {table.search && (
        <Input
          type="search"
          aria-label="Find rows"
          placeholder="Find"
          value={query}
          className="max-w-xs"
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(0)
          }}
        />
      )}
      <div className={FRAME}>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {table.columns.map((column, place) => {
                const by = order?.key === column.key ? order : undefined
                return (
                  <TableHead
                    key={column.key}
                    aria-sort={
                      by ? (by.down ? "descending" : "ascending") : undefined
                    }
                    className={cn(right[place] && "text-right")}
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-control outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                      onClick={() => {
                        setOrder(nextOrder(order, column.key))
                        setPage(0)
                      }}
                    >
                      {column.title}
                      {by &&
                        (by.down ? (
                          <ArrowDownIcon className="size-3" />
                        ) : (
                          <ArrowUpIcon className="size-3" />
                        ))}
                    </button>
                  </TableHead>
                )
              })}
              {actions.length > 0 && (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow
                key={places.get(row)}
                {...(opens && {
                  tabIndex: 0,
                  "aria-label": `Open ${wordsOf(row[table.columns[0]!.key])}`,
                  className: "cursor-pointer",
                  onClick: () => {
                    // Text dragged over to copy is not a click on its row.
                    if (window.getSelection()?.toString()) return
                    opening?.(opens.view, opensWith(opens, row))
                  },
                  onKeyDown: (event: React.KeyboardEvent) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    opening?.(opens.view, opensWith(opens, row))
                  },
                })}
              >
                {table.columns.map((column, place) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      place > 0 && "text-muted-foreground",
                      right[place] && "text-right tabular-nums"
                    )}
                  >
                    <CellView cell={row[column.key]} column={column} />
                  </TableCell>
                ))}
                {actions.length > 0 && (
                  // A click on what is done with the row does not open it.
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <RowActions actions={actions} row={row} send={send} />
                  </TableCell>
                )}
              </TableRow>
            ))}
            {shown.length === 0 && query.trim() !== "" && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={table.columns.length + (actions.length > 0 ? 1 : 0)}
                  className="text-center text-muted-foreground"
                >
                  No row has “{query.trim()}”.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-meta text-muted-foreground">
          <span className="tabular-nums">
            {at * PAGE + 1}–{at * PAGE + shown.length} of {rows.length}
          </span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={at === 0}
            onClick={() => setPage(at - 1)}
          >
            Previous
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={at >= pages - 1}
            onClick={() => setPage(at + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
