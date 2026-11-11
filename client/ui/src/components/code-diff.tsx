/**
 * Changes to files, drawn as T3 Code draws them: `@pierre/diffs`' code
 * view, stacked or split, with line numbers, colours, sticky file headers
 * and context to expand, virtualised and highlighted in workers (ADR 0034,
 * decision 2). Its colours are Banda's `added` and `removed`, mixed into
 * the tile as T3 Code mixes them.
 */
import {
  parseDiffFromFile,
  parsePatchFiles,
  type DiffLineAnnotation,
  type FileDiffContentsLoader,
  type FileDiffMetadata,
} from "@pierre/diffs"
import {
  CodeView,
  WorkerPoolContextProvider,
  type CodeViewAnnotationArgs,
  type CodeViewHandle,
  type CodeViewItem,
} from "@pierre/diffs/react"
import {
  type ReactNode,
  type Ref,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { useDark } from "../hooks/use-dark"
import { cn } from "../lib/utils"
import { BASE_CSS, HIGHLIGHTER, POOL, THEMES, VIEW_CLASS } from "./code-look"

export type { FileDiffMetadata } from "@pierre/diffs"

/** The view's handle: a hunk's mark is its index in its file. */
export type CodeDiffHandle = CodeViewHandle<number, undefined>

/** T3 Code's sizes: 32 px headers, which a folded file never measures again. */
const METRICS = {
  diffHeaderHeight: 32,
  hunkSeparatorHeight: 24,
  spacing: 0,
  paddingTop: 0,
  paddingBottom: 8,
}
const LAYOUT = { paddingTop: 0, paddingBottom: 0, gap: 0 }

/** The files of a git patch, in their order, or none when it holds none. */
export function filesOf(patch: string, key: string): FileDiffMetadata[] {
  if (!patch.trim()) return []
  return parsePatchFiles(patch, key).flatMap((parsed) => parsed.files)
}

/** Files diffed from their texts, by path, newest last: the same change
 * read again is the same file, which the view keeps. */
const MADE = new Map<
  string,
  { old: string | undefined; text: string; file: FileDiffMetadata }
>()
const MOST_MADE = 200

/** A file's change from its text before (none for a new file) to its
 * text after, whole, so all its context can show. */
export function fileOf(
  path: string,
  old: string | undefined,
  text: string
): FileDiffMetadata {
  const known = MADE.get(path)
  if (known && known.old === old && known.text === text) return known.file
  const parsed = parseDiffFromFile(
    { name: path, contents: old ?? "" },
    { name: path, contents: text }
  )
  const file: FileDiffMetadata =
    old === undefined ? { ...parsed, type: "new" } : parsed
  MADE.delete(path)
  MADE.set(path, { old, text, file })
  if (MADE.size > MOST_MADE) MADE.delete(MADE.keys().next().value!)
  return file
}

/** The lines a file's change adds and removes. */
export function countsOf(file: FileDiffMetadata): {
  added: number
  removed: number
} {
  let added = 0
  let removed = 0
  for (const hunk of file.hunks) {
    added += hunk.additionLines
    removed += hunk.deletionLines
  }
  return { added, removed }
}

/** The path a file has after the change, or before it when it went. */
export function pathOf(file: FileDiffMetadata): string {
  return file.name || file.prevName || ""
}

/** What tells a file from another in one diff, and the same file again. */
export function keyOf(file: FileDiffMetadata): string {
  return `${file.prevName ?? ""}\0${pathOf(file)}\0${file.type}`
}

/** A number for each patch of a file the view is given. */
const numbers = new WeakMap<FileDiffMetadata, number>()
let counted = 0

/** What tells the view to draw an item again: a new patch of its file, a
 * new fold, or its hunks marked or not; it keeps an item whose version
 * stayed. */
function versionOf(
  file: FileDiffMetadata,
  collapsed: boolean,
  marked: boolean
): number {
  let number = numbers.get(file)
  if (number === undefined) numbers.set(file, (number = ++counted))
  return number * 4 + (collapsed ? 2 : 0) + (marked ? 1 : 0)
}

/** A mark under each hunk's first line, where what it can do is drawn
 * over it: on the old side when the hunk begins with lines removed, which
 * are drawn first, else on the new. */
function marksOf(file: FileDiffMetadata): DiffLineAnnotation<number>[] {
  return file.hunks.map((hunk, index) => {
    const first = hunk.hunkContent[0]
    const removedFirst =
      (first?.type === "change" && first.deletions > 0) ||
      hunk.additionCount === 0
    return removedFirst
      ? { side: "deletions", lineNumber: hunk.deletionStart, metadata: index }
      : { side: "additions", lineNumber: hunk.additionStart, metadata: index }
  })
}

/** The hunk of `file` a line is in, on its side: its index, or -1. */
function hunkAt(
  file: FileDiffMetadata,
  side: "additions" | "deletions",
  line: number
): number {
  return file.hunks.findIndex((hunk) => {
    const [start, count] =
      side === "additions"
        ? [hunk.additionStart, hunk.additionCount]
        : [hunk.deletionStart, hunk.deletionCount]
    return line >= start && line < start + count
  })
}

/** The hunk the pointer is on: its file's item and its index. */
type Pointed = { item: string; hunk: number } | null

/** Where the pointer is, told to each hunk's plate as it moves to
 * another hunk. */
function pointer() {
  let pointed: Pointed = null
  const told = new Set<() => void>()
  return {
    get: () => pointed,
    set(next: Pointed) {
      if (next?.item === pointed?.item && next?.hunk === pointed?.hunk) return
      pointed = next
      for (const tell of told) tell()
    },
    subscribe(tell: () => void) {
      told.add(tell)
      return () => told.delete(tell)
    },
  }
}
type Pointer = ReturnType<typeof pointer>

export type CodeDiffProps = {
  files: readonly FileDiffMetadata[]
  /** The keys of the files shown folded. */
  folded: ReadonlySet<string>
  layout: "stacked" | "split"
  wrap: boolean
  /** Reads a file whole, for its context to expand. */
  load?: FileDiffContentsLoader
  /** Drawn before a file's path, by the file's key: its fold, say. */
  prefix?: (key: string) => ReactNode
  /** Drawn after the last file: where more load, say. */
  footer?: () => ReactNode
  /** Drawn after a file's counts: what can be done to it. */
  actions?: (file: FileDiffMetadata) => ReactNode
  /** Drawn at a hunk's top right while the pointer is on it: what can be
   * done to the hunk, by its index in the file; none draws nothing. */
  hunkActions?: (file: FileDiffMetadata, hunk: number) => ReactNode
  viewer?: Ref<CodeDiffHandle>
  className?: string
}

export function CodeDiff({
  files,
  folded,
  layout,
  wrap,
  load,
  prefix,
  footer,
  actions,
  hunkActions,
  viewer,
  className,
}: CodeDiffProps) {
  const dark = useDark()
  const marked = hunkActions !== undefined
  const items = useMemo<CodeViewItem<number>[]>(
    () =>
      files.map((file) => {
        const id = keyOf(file)
        const collapsed = folded.has(id)
        return {
          id,
          type: "diff",
          fileDiff: file,
          collapsed,
          version: versionOf(file, collapsed, marked),
          ...(marked ? { annotations: marksOf(file) } : {}),
        }
      }),
    [files, folded, marked]
  )
  const [pointed] = useState(pointer)
  // The pointer leaving the view leaves every hunk; one callback for the
  // view's life, as the view sets itself up again for a new one.
  const [watch] = useState(() => {
    const leave = () => pointed.set(null)
    let watched: HTMLDivElement | null = null
    return (element: HTMLDivElement | null) => {
      watched?.removeEventListener("pointerleave", leave)
      watched = element
      element?.addEventListener("pointerleave", leave)
    }
  })
  // Pierre draws every file again when its options are a new object.
  const options = useMemo(
    () => ({
      diffStyle: layout === "split" ? ("split" as const) : ("unified" as const),
      lineDiffType: "none" as const,
      overflow: wrap ? ("wrap" as const) : ("scroll" as const),
      theme: THEMES,
      themeType: dark ? ("dark" as const) : ("light" as const),
      stickyHeaders: true,
      ...(load ? { loadDiffFiles: load } : {}),
      // A hunk shows what it can do while the pointer is on its lines, or
      // on what it shows, which is on none.
      ...(marked
        ? {
            onLineEnter: (
              line: {
                lineNumber: number
                annotationSide?: "additions" | "deletions"
              },
              context: { item: CodeViewItem<number> }
            ) => {
              const { item } = context
              if (item.type === "diff" && line.annotationSide)
                pointed.set({
                  item: item.id,
                  hunk: hunkAt(
                    item.fileDiff,
                    line.annotationSide,
                    line.lineNumber
                  ),
                })
            },
          }
        : {}),
      unsafeCSS: CSS,
      itemMetrics: METRICS,
      layout: LAYOUT,
    }),
    [layout, wrap, dark, load, marked, pointed]
  )
  return (
    <WorkerPoolContextProvider
      poolOptions={POOL}
      highlighterOptions={HIGHLIGHTER}
    >
      <CodeView<number>
        {...(viewer ? { ref: viewer } : {})}
        containerRef={watch}
        items={items}
        className={cn(VIEW_CLASS, className)}
        {...(prefix
          ? {
              renderHeaderPrefix: (item: CodeViewItem<number>) =>
                prefix(item.id),
            }
          : {})}
        {...(actions
          ? {
              renderHeaderMetadata: (item: CodeViewItem<number>) =>
                item.type === "diff" ? actions(item.fileDiff) : null,
            }
          : {})}
        {...(hunkActions
          ? {
              renderAnnotation: (
                ...[annotation, , item]: CodeViewAnnotationArgs<number>
              ) => {
                if (item.type !== "diff") return null
                const actions = hunkActions(item.fileDiff, annotation.metadata)
                return actions ? (
                  <HunkPlate
                    pointed={pointed}
                    item={item.id}
                    hunk={annotation.metadata}
                  >
                    {actions}
                  </HunkPlate>
                ) : null
              },
            }
          : {})}
        {...(footer ? { renderCodeViewFooter: footer } : {})}
        options={options}
      />
    </WorkerPoolContextProvider>
  )
}

/** What a hunk can do, drawn over the right of its first line while the
 * pointer is on the hunk, or while a popup opened from it is open. */
function HunkPlate({
  pointed,
  item,
  hunk,
  children,
}: {
  pointed: Pointer
  item: string
  hunk: number
  children: ReactNode
}) {
  const on = useSyncExternalStore(pointed.subscribe, () => {
    const at = pointed.get()
    return at?.item === item && at.hunk === hunk
  })
  return (
    <div data-hunk-actions className="relative h-0">
      <div
        className={cn(
          "absolute right-2 bottom-0 flex items-center gap-0.5 rounded-control bg-popover font-sans text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-[opacity,visibility] duration-100 [&_[data-slot=button]]:h-5",
          !on &&
            "invisible opacity-0 has-data-popup-open:visible has-data-popup-open:opacity-100"
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** T3 Code's look for the view, on Banda's tokens: the surface is the
 * tile, rows mix `added` and `removed` into it (stronger in dark, and
 * stronger again on the numbers), headers are sticky and 32 px. */
const CSS = `${BASE_CSS}
[data-change-icon="new"] { color: var(--added) !important; }
[data-change-icon="deleted"] { color: var(--removed) !important; }
/* Modified files stay quiet: a muted blue. */
[data-change-icon="change"],
[data-change-icon="rename-pure"],
[data-change-icon="rename-changed"] {
  color: color-mix(in srgb, var(--chart-2, var(--primary)) 50%, var(--muted-foreground)) !important;
}

[data-file-info] {
  background-color: var(--code) !important;
  border-block-color: transparent !important;
  color: var(--ink) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: var(--code) !important;
  border-bottom-color: transparent !important;
  align-items: center !important;
  font-family: var(--font-sans) !important;
  font-size: var(--meta-size) !important;
  line-height: 1 !important;
  height: 32px !important;
  min-height: 32px !important;
  padding-block: 0 !important;
  padding-inline: 8px 12px !important;
}
[data-diffs-header]:hover {
  box-shadow: inset 3px 0 color-mix(in srgb, var(--ink) 24%, transparent);
}
[data-diffs-header] [data-header-content],
[data-diffs-header] [data-metadata] {
  align-items: center !important;
  line-height: 1 !important;
  font-variant-numeric: tabular-nums;
}
[data-diffs-header] :is([data-title], [data-prev-name]) { line-height: 16px !important; }
[data-diffs-header] [data-additions-count],
[data-diffs-header] [data-deletions-count] {
  font-family: var(--font-mono) !important;
  font-size: var(--meta-size) !important;
  font-variant-numeric: tabular-nums;
  line-height: 1 !important;
}
[data-diffs-header] [data-change-icon],
[data-diffs-header] [data-rename-icon] { display: block; flex-shrink: 0; }
[data-title] { cursor: pointer; transition: color 120ms ease; font-family: var(--font-sans) !important; }
[data-title]:hover { color: color-mix(in srgb, var(--ink) 84%, var(--primary)) !important; }

:is([data-separator="line-info"], [data-separator="line-info-basic"]) {
  height: 24px !important;
  margin-block: 0 !important;
  --diffs-bg-separator: color-mix(in srgb, var(--code) 97%, var(--ink));
}
:is([data-separator="line-info"], [data-separator="line-info-basic"]) [data-separator-content],
:is([data-separator="line-info"], [data-separator="line-info-basic"]) [data-expand-button] {
  color: color-mix(in srgb, var(--ink) 50%, var(--code)) !important;
  font-family: var(--font-sans) !important;
  font-size: var(--meta-size) !important;
  text-decoration: none !important;
}
:is([data-separator="line-info"], [data-separator="line-info-basic"])[data-expand-index]
  :is([data-separator-content], [data-expand-button]):hover {
  color: var(--ink) !important;
  background-color: color-mix(in srgb, var(--code) 92%, var(--ink)) !important;
}

/* Both code columns keep one width in split and wrap, so rows never rewrap
   as lines mount. */
[data-diff-type="split"][data-overflow="wrap"] {
  --diffs-code-grid: var(--diffs-grid-number-column-width) minmax(0, 1fr);
}
`
