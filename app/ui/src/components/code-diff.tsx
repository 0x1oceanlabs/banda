/**
 * Changes to files, drawn as T3 Code draws them: `@pierre/diffs`' code
 * view, stacked or split, with line numbers, colours, sticky file headers
 * and context to expand, virtualised and highlighted in workers (ADR 0034,
 * decision 2). Its colours are Banda's `added` and `removed`, mixed into
 * the tile as T3 Code mixes them.
 */
import {
  parsePatchFiles,
  type FileDiffContentsLoader,
  type FileDiffMetadata,
} from "@pierre/diffs"
import {
  CodeView,
  WorkerPoolContextProvider,
  type CodeViewHandle,
  type CodeViewItem,
} from "@pierre/diffs/react"
import { type ReactNode, type Ref, useMemo } from "react"
import { useDark } from "../hooks/use-dark"
import { cn } from "cn"

export type { FileDiffMetadata } from "@pierre/diffs"
export type { CodeViewHandle } from "@pierre/diffs/react"

const THEMES = { dark: "pierre-dark", light: "pierre-light" } as const

/** One pool of highlighting workers for every diff in the window. */
const POOL = {
  workerFactory: () =>
    new Worker(new URL("./diffs-worker.ts", import.meta.url), {
      type: "module",
    }),
  poolSize: Math.max(
    2,
    Math.min(6, Math.floor((navigator.hardwareConcurrency || 4) / 2))
  ),
  totalASTLRUCacheSize: 240,
}
const HIGHLIGHTER = { theme: THEMES, tokenizeMaxLineLength: 1_000 }
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

/** What tells the view to draw an item again: a new patch of its file, or
 * a new fold; it keeps an item whose version stayed. */
function versionOf(file: FileDiffMetadata, collapsed: boolean): number {
  let number = numbers.get(file)
  if (number === undefined) numbers.set(file, (number = ++counted))
  return number * 2 + (collapsed ? 1 : 0)
}

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
  viewer?: Ref<CodeViewHandle<undefined, undefined>>
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
  viewer,
  className,
}: CodeDiffProps) {
  const dark = useDark()
  const items = useMemo<CodeViewItem<undefined>[]>(
    () =>
      files.map((file) => {
        const id = keyOf(file)
        const collapsed = folded.has(id)
        return {
          id,
          type: "diff",
          fileDiff: file,
          collapsed,
          version: versionOf(file, collapsed),
        }
      }),
    [files, folded]
  )
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
      unsafeCSS: CSS,
      itemMetrics: METRICS,
      layout: LAYOUT,
    }),
    [layout, wrap, dark, load]
  )
  return (
    <WorkerPoolContextProvider
      poolOptions={POOL}
      highlighterOptions={HIGHLIGHTER}
    >
      <CodeView<undefined>
        {...(viewer ? { ref: viewer } : {})}
        items={items}
        className={cn(
          "[--diff-number:35%] [--diff-row:50%] dark:[--diff-number:60%] dark:[--diff-row:70%]",
          "outline-none",
          className
        )}
        {...(prefix
          ? {
              renderHeaderPrefix: (item: CodeViewItem<undefined>) =>
                prefix(item.id),
            }
          : {})}
        {...(footer ? { renderCodeViewFooter: footer } : {})}
        options={options}
      />
    </WorkerPoolContextProvider>
  )
}

/** T3 Code's look for the view, on Banda's tokens: the surface is the
 * tile, rows mix `added` and `removed` into it (stronger in dark, and
 * stronger again on the numbers), headers are sticky and 32 px. */
const CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --code: var(--background);
  --ink: var(--foreground);
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--font-mono) !important;
  --diffs-bg: var(--code) !important;
  --diffs-light-bg: var(--code) !important;
  --diffs-dark-bg: var(--code) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
  --diffs-bg-context-override: color-mix(in srgb, var(--code) 97%, var(--ink));
  --diffs-bg-hover-override: color-mix(in srgb, var(--code) 94%, var(--ink));
  --diffs-bg-separator-override: color-mix(in srgb, var(--code) 95%, var(--ink));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--code) 90%, var(--ink));
  --diffs-bg-addition-override: color-mix(in srgb, var(--code) var(--diff-row), var(--added));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--code) var(--diff-number), var(--added));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--code) 85%, var(--added));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--code) 80%, var(--added));
  --diffs-bg-deletion-override: color-mix(in srgb, var(--code) var(--diff-row), var(--removed));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--code) var(--diff-number), var(--removed));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--code) 85%, var(--removed));
  --diffs-bg-deletion-emphasis-override: color-mix(in srgb, var(--code) 80%, var(--removed));
  background-color: var(--diffs-bg) !important;
  color: var(--ink) !important;
}

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
  font-size: 12px !important;
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
  font-size: 11px !important;
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
  font-size: 11px !important;
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

[data-diff], [data-file] { transition: opacity 200ms ease-out; }
@starting-style { [data-diff], [data-file] { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { [data-diff], [data-file] { transition: none; } }
`
