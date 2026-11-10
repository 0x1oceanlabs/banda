/**
 * Words found in the files of a folder (ADR 0073, decision 11):
 * Ctrl+Shift+F turns Files' tree into the lines `files.search` finds,
 * grouped by file, as they come, again as one types. Its options are
 * toggles: a pattern, case, whole words. ↑↓ move, ← and → fold a file, ↵
 * opens the file at its line, lit; Esc gives the tree back.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import {
  VirtualList,
  type VirtualListHandle,
} from "@banda/ui/components/virtual-list"
import { cn } from "@banda/ui/lib/utils"
import {
  CaseSensitiveIcon,
  ChevronRightIcon,
  FileIcon,
  RegexIcon,
  SearchIcon,
  WholeWordIcon,
  XIcon,
} from "lucide-react"
import { lit, linesIn, NOTHING, type Found, rowsOf, withPiece } from "./found"
import { HeaderButton } from "./HeaderButton"

/** How long the typing rests before the files are searched, in ms. */
const WAIT = 150
const ROW = 22

type Options = { regex: boolean; case: boolean; word: boolean }

export function SearchView({
  engine,
  project,
  dir,
  onOpen,
  onClose,
}: {
  engine: Engine
  project: ProjectId
  /** The folder searched, whole. */
  dir: string
  /** Opens a file found, by its path from `dir`, at a line. */
  onOpen: (path: string, line: number | null) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<Options>({
    regex: false,
    case: false,
    word: false,
  })
  const [found, setFound] = useState<Found>(NOTHING)
  const [refused, setRefused] = useState<string | null>(null)
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const [at, setAt] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<VirtualListHandle>(null)

  useEffect(() => {
    if (!query) return
    let stop = () => {}
    const timer = setTimeout(() => {
      setFound(NOTHING)
      setRefused(null)
      setAt(0)
      stop = engine.stream(
        project,
        "files.search",
        { dir, query, ...options },
        (piece) => setFound((was) => withPiece(was, piece)),
        (refusal) => refusal && setRefused(refusal.message)
      )
    }, WAIT)
    return () => {
      clearTimeout(timer)
      stop()
    }
  }, [engine, project, dir, query, options])
  const shown = query ? found : NOTHING

  const rows = useMemo(() => rowsOf(shown.files, folded), [shown, folded])
  const active = Math.min(at, rows.length - 1)
  useEffect(() => {
    if (active >= 0) list.current?.scrollTo(active, "nearest")
  }, [active])

  const fold = (path: string, shut: boolean) =>
    setFolded((was) => {
      const next = new Set(was)
      if (shut) next.add(path)
      else next.delete(path)
      return next
    })
  const open = (index: number) => {
    const row = rows[index]
    if (!row) return
    if (row.kind === "line") onOpen(row.path, row.matched.line)
    else
      onOpen(
        row.path,
        shown.files.find((f) => f.path === row.path)?.lines[0]?.line ?? null
      )
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    const row = rows[active]
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (step !== undefined) {
      if (step === -1 && active <= 0) field.current?.focus()
      else setAt(Math.max(0, Math.min(rows.length - 1, active + step)))
    } else if (event.key === "Enter") open(active)
    else if (event.key === "ArrowLeft" && row) {
      fold(row.path, true)
      setAt(
        rows.findIndex((one) => one.kind === "file" && one.path === row.path)
      )
    } else if (event.key === "ArrowRight" && row?.kind === "file")
      fold(row.path, false)
    else if (event.key === "Escape") onClose()
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  const toggle = (
    name: keyof Options,
    label: string,
    icon: React.ReactNode
  ) => (
    <HeaderButton
      label={label}
      on={options[name]}
      onClick={() => setOptions((was) => ({ ...was, [name]: !was[name] }))}
    >
      {icon}
    </HeaderButton>
  )
  const lines = linesIn(shown.files)
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      role="search"
      aria-label="Search in files"
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b pr-1 pl-2.5">
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={field}
          autoFocus
          aria-label="Search in files"
          placeholder="Search in files"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            } else if (event.key === "Enter" || event.key === "ArrowDown") {
              event.preventDefault()
              if (event.key === "Enter" && rows.length > 0) open(active)
              else list.current?.focus()
            }
          }}
          className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
        {toggle("case", "Match case", <CaseSensitiveIcon />)}
        {toggle("word", "Whole words", <WholeWordIcon />)}
        {toggle("regex", "Regular expression", <RegexIcon />)}
        <HeaderButton label="Close the search" onClick={onClose}>
          <XIcon />
        </HeaderButton>
      </div>
      {query && (
        <div
          role="status"
          className="flex h-6 shrink-0 items-center px-2.5 text-[10.5px] text-muted-foreground"
        >
          {refused ??
            (shown.done
              ? lines === 0
                ? `Nothing found for “${query}”.`
                : `${lines} ${lines === 1 ? "line" : "lines"} in ${shown.files.length} ${shown.files.length === 1 ? "file" : "files"}${shown.done.cut ? ", the first only" : ""}`
              : "Searching…")}
        </div>
      )}
      <VirtualList
        ref={list}
        role="tree"
        aria-label="Found"
        tabIndex={0}
        className="min-h-0 flex-1 px-1 outline-none"
        count={rows.length}
        rowHeight={ROW}
        onKeyDown={onKeyDown}
        row={(index, style) => {
          const row = rows[index]
          const on = index === active
          const common = {
            style,
            role: "treeitem",
            "aria-selected": on,
            onClick: () => setAt(index),
            onDoubleClick: () => open(index),
            className: cn(
              "flex cursor-default items-center gap-1.5 rounded-small pr-2 text-xs",
              on && "bg-foreground/10"
            ),
          } as const
          if (row.kind === "file")
            return (
              <div
                {...common}
                key={`f:${row.path}`}
                aria-expanded={!row.folded}
                aria-label={row.path}
                className={cn(common.className, "pl-1")}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={row.folded ? "Open" : "Fold"}
                  onClick={(event) => {
                    event.stopPropagation()
                    fold(row.path, !row.folded)
                  }}
                  className="flex size-4 items-center justify-center text-muted-foreground"
                >
                  <ChevronRightIcon
                    className={cn(
                      "size-3 transition-transform",
                      !row.folded && "rotate-90"
                    )}
                  />
                </button>
                <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">
                  {row.path.split("/").at(-1)}
                </span>
                <span className="min-w-0 truncate text-[10.5px] text-muted-foreground">
                  {row.path.includes("/")
                    ? row.path.slice(0, row.path.lastIndexOf("/"))
                    : ""}
                </span>
                <span className="ml-auto shrink-0 rounded-full bg-foreground/8 px-1.5 text-[10px] text-muted-foreground tabular-nums">
                  {row.count}
                  {row.more && "+"}
                </span>
              </div>
            )
          return (
            <div
              {...common}
              key={`l:${row.path}:${row.matched.line}`}
              aria-label={`${row.path}:${row.matched.line}`}
              className={cn(common.className, "pl-7 font-mono text-[11px]")}
            >
              <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">
                {row.matched.line}
              </span>
              <span className="min-w-0 truncate whitespace-pre">
                {lit(row.matched).map((piece, n) =>
                  piece.lit ? (
                    <mark
                      key={n}
                      className="rounded-small bg-warning/30 text-foreground"
                    >
                      {piece.text}
                    </mark>
                  ) : (
                    <span key={n}>{piece.text}</span>
                  )
                )}
              </span>
            </div>
          )
        }}
      />
    </div>
  )
}
