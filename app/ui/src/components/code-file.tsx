/**
 * A file's text, drawn as the Diff draws code (ADR 0073, decision 6):
 * `@pierre/diffs`' file view, numbered and coloured in the window's
 * workers, virtualised. It opens at a line, centred and lit once, and
 * the Person picks lines in its gutter: a click, a drag, or Shift with a
 * click, and may write a comment under them. It reads; editing comes
 * later, behind Banda's own `Editor`.
 */
import {
  CodeView,
  File,
  WorkerPoolContextProvider,
  type CodeViewHandle,
  type CodeViewItem,
} from "@pierre/diffs/react"
import { useEffect, useMemo, useRef } from "react"
import { useDark } from "../hooks/use-dark"
import { cn } from "../lib/utils"
import { BASE_CSS, HIGHLIGHTER, POOL, THEMES, VIEW_CLASS } from "./code-look"

export { JSON_COLOURS } from "./code-look"
import { LineComment } from "./line-comment"

/** Lines picked in the gutter, first to last as they were dragged. */
export type LineRange = { start: number; end: number }

/** The one item the view holds. */
const ID = "file"
/** No header: the Pane's names the file. A little room above and below. */
const METRICS = {
  diffHeaderHeight: 0,
  spacing: 0,
  paddingTop: 6,
  paddingBottom: 6,
}
const LAYOUT = { paddingTop: 0, paddingBottom: 0, gap: 0 }
/** How long the view is given to draw a line before it is lit, in ms:
 * the window's first file waits for its workers to start. */
const DRAWN_WITHIN = 5_000

/** A number for each text the view is given: a new one draws again. */
let counted = 0

export type CodeFileProps = {
  /** Its name, which says the language it is coloured as. */
  name: string
  text: string
  wrap: boolean
  /** The line shown centred and lit once, as it is given or changes. */
  line?: number | null
  /** The lines picked; none for none. */
  picked: LineRange | null
  onPick: (range: LineRange | null) => void
  /** A comment is written under the lines picked: what it says once
   * written, and its cancel. */
  comment?: {
    onComment: (words: string) => void
    onCancel: () => void
  } | null
  className?: string
}

/** Lines as a person names them: `12`, or `12–14` first to last. */
export function linesWords({ start, end }: LineRange): string {
  const [first, last] = [Math.min(start, end), Math.max(start, end)]
  return first === last ? `${first}` : `${first}–${last}`
}

export function CodeFile({
  name,
  text,
  wrap,
  line,
  picked,
  onPick,
  comment,
  className,
}: CodeFileProps) {
  const dark = useDark()
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null)
  const root = useRef<HTMLDivElement | null>(null)
  // The comment's form sits under the last line picked.
  const under = comment && picked ? Math.max(picked.start, picked.end) : null
  const items = useMemo<CodeViewItem<undefined>[]>(
    () => [
      {
        id: ID,
        type: "file",
        file: { name, contents: text },
        ...(under !== null ? { annotations: [{ lineNumber: under }] } : {}),
        version: ++counted,
      },
    ],
    [name, text, under]
  )
  // What the form does, as it is now: the view keeps the first renderer.
  const commenting = useRef(comment)
  useEffect(() => {
    commenting.current = comment
  })
  // Pierre draws the file again when its options are a new object.
  const options = useMemo(
    () => ({
      theme: THEMES,
      themeType: dark ? ("dark" as const) : ("light" as const),
      overflow: wrap ? ("wrap" as const) : ("scroll" as const),
      disableFileHeader: true,
      // Lines stay as picked while their comment is written.
      enableLineSelection: under === null,
      unsafeCSS: CSS,
      itemMetrics: METRICS,
      layout: LAYOUT,
    }),
    [dark, wrap, under]
  )
  const selected = useMemo(
    () => (picked ? { id: ID, range: picked } : null),
    [picked]
  )

  // The line asked for: centred, then centred again once the view has
  // drawn it, as its rows' heights are known only then; then lit.
  useEffect(() => {
    if (!line) return
    // Pierre's own centre takes the view's height as it was first drawn,
    // which a tile growing into its place scales: the layout's is right.
    const centre = (rows: Element[]) => {
      const height = (rows[0] as HTMLElement | undefined)?.offsetHeight ?? 20
      viewer.current?.scrollTo({
        type: "line",
        id: ID,
        lineNumber: line,
        align: "start",
        offset: ((root.current?.clientHeight ?? 0) - height) / 2,
      })
    }
    const until = performance.now() + DRAWN_WITHIN
    let centred = false
    const step = () => {
      const rows = rowsAt(root.current, line)
      if (rows.length > 0 && centred) return light(root.current, rows, line)
      if (rows.length > 0) {
        centre(rows)
        centred = true
      }
      if (performance.now() < until) frame = requestAnimationFrame(step)
    }
    let frame = requestAnimationFrame(() => {
      centre([])
      step()
    })
    return () => cancelAnimationFrame(frame)
  }, [line])

  return (
    <WorkerPoolContextProvider
      poolOptions={POOL}
      highlighterOptions={HIGHLIGHTER}
    >
      <CodeView<undefined>
        ref={viewer}
        containerRef={root}
        items={items}
        className={cn(VIEW_CLASS, className)}
        selectedLines={selected}
        onSelectedLinesChange={(selection) => onPick(selection?.range ?? null)}
        renderAnnotation={() =>
          picked && commenting.current ? (
            <LineComment
              lines={linesWords(picked)}
              onComment={(words) => commenting.current?.onComment(words)}
              onCancel={() => commenting.current?.onCancel()}
            />
          ) : null
        }
        options={options}
      />
    </WorkerPoolContextProvider>
  )
}

/** A few lines of code, read only and as tall as they are, numbered and
 * coloured as a file's: a notebook's cell. Not virtualised, so it takes
 * its place in a page that scrolls. */
export function CodeLines({
  name,
  text,
  className,
}: {
  /** Its name, which says the language it is coloured as. */
  name: string
  text: string
  className?: string
}) {
  const dark = useDark()
  const file = useMemo(() => ({ name, contents: text }), [name, text])
  const options = useMemo(
    () => ({
      theme: THEMES,
      themeType: dark ? ("dark" as const) : ("light" as const),
      overflow: "wrap" as const,
      disableFileHeader: true,
      unsafeCSS: BASE_CSS,
    }),
    [dark]
  )
  return (
    <WorkerPoolContextProvider
      poolOptions={POOL}
      highlighterOptions={HIGHLIGHTER}
    >
      <File file={file} options={options} className={className} />
    </WorkerPoolContextProvider>
  )
}

/** The rows of line `line` the view has drawn: its number and its code. */
function rowsAt(root: HTMLElement | null, line: number): Element[] {
  const files = root?.querySelectorAll("diffs-container") ?? []
  return [...files].flatMap((file) => [
    ...(file.shadowRoot?.querySelectorAll(
      `[data-line="${line}"], [data-column-number="${line}"]`
    ) ?? []),
  ])
}

/** Lights `rows`, line `line`'s, once; the view says which line it lit
 * last. */
function light(root: HTMLElement | null, rows: Element[], line: number) {
  for (const row of rows) {
    row.removeAttribute("data-lit")
    // Read once, so the light starts again on a row lit before.
    void (row as HTMLElement).offsetWidth
    row.setAttribute("data-lit", "")
    const done = () => row.removeAttribute("data-lit")
    row.addEventListener("animationend", done, { once: true })
  }
  root?.setAttribute("data-lit-line", String(line))
}

/** The Diff's look, and a line lit as a note in a reply is (ADR 0063,
 * decision 1): `--primary` at 14%, fading over a second. */
const CSS = `${BASE_CSS}
@keyframes banda-lit {
  from { background-color: color-mix(in srgb, var(--primary) 14%, var(--code)); }
  to { background-color: var(--code); }
}
[data-lit] { animation: banda-lit 1s ease-out 1; }
@media (prefers-reduced-motion: reduce) { [data-lit] { animation-duration: 1ms; } }
`
