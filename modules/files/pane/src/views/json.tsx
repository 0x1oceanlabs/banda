/**
 * Files' JSON (ADR 0073, decision 6): a JSON, a JSONC or JSON Lines as a
 * tree that folds, its parts coloured as the code view colours them. A
 * row's path, as `jq` writes it, and its value copy from the row; the
 * header opens the tree to a depth, and shows the source. The arrows
 * move and fold, Ctrl+C (⌘C) copies the value picked. Past 5 MB, or as
 * text that does not parse, it shows as code.
 */
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@banda/ui/components/button"
import { JSON_COLOURS } from "@banda/ui/components/code-file"
import { CopyButton } from "@banda/ui/components/copy-button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { InHeader } from "@banda/ui/components/pane-header"
import {
  VirtualList,
  type VirtualListHandle,
} from "@banda/ui/components/virtual-list"
import { copyText } from "@banda/ui/lib/clipboard"
import { matches } from "@banda/ui/lib/keys"
import { extensionOf } from "@banda/ui/lib/previewers"
import { cn } from "@banda/ui/lib/utils"
import type { PreviewProps } from "@banda/ui/module"
import {
  ChevronRightIcon,
  CodeIcon,
  LinkIcon,
  ListTreeIcon,
} from "lucide-react"
import { Loading } from "../Facts"
import { HeaderButton } from "../HeaderButton"
import {
  copyValue,
  type Doc,
  docsOf,
  holdsAtMost,
  isLines,
  openTo,
  type Row,
  rowsOf,
  valueText,
} from "../json"
import CodeView from "./code"
import { useWhole } from "./whole"

/** Past this many bytes a JSON shows as code. */
const MOST = 5_000_000
/** A JSON of this many rows at most opens whole. */
const SMALL = 200
/** A row's height, and a level's step in, in px. */
const HEIGHT = 22
const STEP = 14
/** Copies the value picked. */
const COPY_KEY = { code: "KeyC", primary: true }

export default function JsonView(props: PreviewProps) {
  const { file, kept, keep } = props
  const big = (file.size ?? 0) > MOST
  const parsed = useDocs(props, big)
  const why = parsed && "why" in parsed ? parsed.why : null
  const source = kept.source === true || big || why !== null
  const [open, setOpen] = useState<{ path: string; ids: Set<string> } | null>(
    null
  )
  const docs = parsed && "docs" in parsed ? parsed.docs : null
  // A small JSON opens whole, a larger one at its top; each line of
  // JSON Lines is folded.
  const ids = useMemo(() => {
    if (open?.path === file.path) return open.ids
    if (!docs || isLines(extensionOf(file.path))) return new Set<string>()
    return openTo(docs, holdsAtMost(docs, SMALL) ? Infinity : 1)
  }, [open, docs, file.path])
  const show = (next: Set<string>) => setOpen({ path: file.path, ids: next })

  return (
    <>
      {!source && docs && (
        <DepthMenu onDepth={(depth) => show(openTo(docs, depth))} />
      )}
      {!big && (
        <InHeader>
          <HeaderButton
            label="Source"
            on={kept.source === true}
            onClick={() => keep({ ...kept, source: kept.source !== true })}
          >
            <CodeIcon />
          </HeaderButton>
        </InHeader>
      )}
      {source ? (
        <>
          {(big || why !== null) && (
            <p className="shrink-0 border-b px-3 py-1 text-xs text-muted-foreground">
              {big
                ? "Past 5 MB a JSON shows as code."
                : `It does not parse as JSON: ${why}`}
            </p>
          )}
          <CodeView {...props} />
        </>
      ) : docs === null ? (
        <Loading />
      ) : (
        <Tree
          label={file.name}
          docs={docs}
          open={ids}
          onOpen={show}
          theme={props.theme}
          mode={props.mode}
        />
      )}
    </>
  )
}

/** `file`'s documents, parsed from its bytes; why not, for text that does
 * not parse; none while it is read, or when it is too big to. */
function useDocs(
  props: PreviewProps,
  big: boolean
): { docs: Doc[] } | { why: string } | null {
  const whole = useWhole(props, big)
  return useMemo(() => {
    if (!whole) return null
    if ("refused" in whole) return { why: whole.refused }
    try {
      const { path, bytes } = whole.answer
      return {
        docs: docsOf(new TextDecoder().decode(bytes), extensionOf(path)),
      }
    } catch (error) {
      return { why: (error as Error).message }
    }
  }, [whole])
}

/** The header's "Expand to a depth". */
function DepthMenu({ onDepth }: { onDepth: (depth: number) => void }) {
  return (
    <InHeader>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Expand to a depth"
              title="Expand to a depth"
              className="shrink-0"
            />
          }
        >
          <ListTreeIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Expand to</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onDepth(0)}>
              Fold all
            </DropdownMenuItem>
            {[1, 2, 3].map((depth) => (
              <DropdownMenuItem key={depth} onClick={() => onDepth(depth)}>
                Depth {depth}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={() => onDepth(Infinity)}>
              Expand all
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </InHeader>
  )
}

/** The tree's rows, the one picked lit; the arrows move and fold. */
function Tree({
  label,
  docs,
  open,
  onOpen,
  theme,
  mode,
}: {
  label: string
  docs: readonly Doc[]
  open: Set<string>
  onOpen: (open: Set<string>) => void
  theme: PreviewProps["theme"]
  mode: PreviewProps["mode"]
}) {
  const rows = useMemo(() => rowsOf(docs, open), [docs, open])
  const [picked, setPicked] = useState<string | null>(null)
  const list = useRef<VirtualListHandle>(null)
  const at = useMemo(
    () => (picked === null ? -1 : rows.findIndex((row) => row.id === picked)),
    [rows, picked]
  )
  // The row picked stays in sight.
  useEffect(() => {
    if (at >= 0) list.current?.scrollTo(at, "nearest")
  }, [at])

  const toggle = (row: Row, to = !row.open) => {
    if (!row.size) return
    const next = new Set(open)
    if (to) next.add(row.id)
    else next.delete(row.id)
    onOpen(next)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const row = rows[at]
    if (matches(event.nativeEvent, COPY_KEY) && row) {
      // Text picked on the page copies as text does.
      if (window.getSelection()?.toString()) return
      event.preventDefault()
      return copyText(copyValue(row.value))
    }
    const go = (index: number) => {
      event.preventDefault()
      const to = rows[Math.max(0, Math.min(rows.length - 1, index))]
      if (to) setPicked(to.id)
    }
    switch (event.key) {
      case "ArrowDown":
        return go(at + 1)
      case "ArrowUp":
        return go(at < 0 ? 0 : at - 1)
      case "Home":
        return go(0)
      case "End":
        return go(rows.length - 1)
      case "ArrowRight":
        if (!row) return go(0)
        event.preventDefault()
        return row.size && !row.open ? toggle(row, true) : go(at + 1)
      case "ArrowLeft": {
        if (!row) return
        event.preventDefault()
        if (row.open) return toggle(row, false)
        // To the folder it is in.
        for (let up = at - 1; up >= 0; up--)
          if (rows[up].depth < row.depth) return go(up)
        return
      }
      case "Enter":
        if (row) {
          event.preventDefault()
          toggle(row)
        }
    }
  }

  const colours = JSON_COLOURS[theme]
  const line = (index: number, style: CSSProperties) => {
    const row = rows[index]
    const on = row.id === picked
    return (
      <div
        role="treeitem"
        aria-level={row.depth + 1}
        aria-expanded={row.size ? row.open : undefined}
        aria-selected={on}
        data-path={row.path}
        style={style}
        onClick={() => setPicked(row.id)}
        onDoubleClick={() => toggle(row)}
        className={cn(
          "group flex items-center gap-1 pr-2 whitespace-pre",
          on ? "bg-muted" : "hover:bg-muted/50"
        )}
      >
        <span style={{ width: row.depth * STEP }} className="shrink-0" />
        {row.size ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={row.open ? "Fold" : "Unfold"}
            onClick={(event) => {
              event.stopPropagation()
              toggle(row)
            }}
            className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronRightIcon
              className={cn(
                "size-3.5 transition-transform",
                row.open && "rotate-90"
              )}
            />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Label row={row} colours={colours} />
        <span className="ml-auto flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100 focus-within:opacity-100">
          <CopyButton
            label="Copy path"
            title={`Copy ${row.path}`}
            text={row.path}
            icon={<LinkIcon />}
            className="text-muted-foreground"
          />
          <CopyButton
            label="Copy value"
            text={() => copyValue(row.value)}
            className="text-muted-foreground"
          />
        </span>
      </div>
    )
  }

  return (
    <VirtualList
      role="tree"
      aria-label={label}
      tabIndex={mode === "pane" ? 0 : -1}
      count={rows.length}
      rowHeight={HEIGHT}
      row={line}
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (picked === null && rows[0]) setPicked(rows[0].id)
      }}
      className="flex-1 py-1 font-mono text-xs outline-none"
    />
  )
}

/** A row's key and value, coloured as the code view colours them. */
function Label({
  row,
  colours,
}: {
  row: Row
  colours: (typeof JSON_COLOURS)["light" | "dark"]
}) {
  const { key, line } = row
  const colour =
    row.kind === "string"
      ? colours.string
      : row.kind === "number" || row.kind === "boolean" || row.kind === "null"
        ? colours.literal
        : undefined
  // A line of JSON Lines, folded, shows what it holds.
  const preview =
    line !== undefined && row.depth === 0 && row.size && !row.open
      ? JSON.stringify(row.value).slice(0, 400)
      : null
  return (
    <span className="min-w-0 truncate">
      {line !== undefined && row.depth === 0 && (
        <span className="mr-2 text-muted-foreground tabular-nums">{line}</span>
      )}
      {typeof key === "number" ? (
        <span className="text-muted-foreground">{key}: </span>
      ) : key !== undefined ? (
        <>
          <span style={{ color: colours.key }}>{JSON.stringify(key)}</span>
          <span className="text-muted-foreground">: </span>
        </>
      ) : null}
      {row.broken ? (
        <span className="text-destructive" title={row.broken.why}>
          {row.broken.text}
        </span>
      ) : (
        <span
          style={colour ? { color: colour } : undefined}
          className={cn(!colour && "text-muted-foreground")}
        >
          {preview ?? valueText(row)}
        </span>
      )}
    </span>
  )
}
