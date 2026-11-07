/**
 * A file's text, drawn as the Diff draws code (ADR 0073, decision 6):
 * `@pierre/diffs`' file view, numbered and coloured in the window's
 * workers, virtualised. It opens at a line, centred and lit once, and
 * the Person picks lines in its gutter: a click, a drag, or Shift with a
 * click, and may write a comment under them. Given an {@link Editor}, its
 * text is edited in place, in the same look (decision 8).
 */
import { Editor as PierreEditor, EditStateManager } from "@pierre/diffs/edit"
import {
  CodeView,
  EditProvider,
  File,
  WorkerPoolContextProvider,
  type CodeViewHandle,
  type CodeViewItem,
  type EditorFactory,
} from "@pierre/diffs/react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { useDark } from "../hooks/use-dark"
import { cn } from "../lib/utils"
import { BASE_CSS, HIGHLIGHTER, POOL, THEMES, VIEW_CLASS } from "./code-look"

export { JSON_COLOURS } from "./code-look"
import { LineComment } from "./line-comment"

/** Lines picked in the gutter, first to last as they were dragged. */
export type LineRange = { start: number; end: number }

/**
 * Banda's editor (ADR 0073, decision 8): what a Pane gives a view of text
 * to have it edited, and hears back. Pierre's editor is the first behind
 * it, in the code view itself; CodeMirror may take a kind of file or a
 * mode later, and no Pane would know.
 */
export type Editor = {
  /** What the file's undo history is kept by while the window runs: its
   * path. What was kept is taken up again only while it holds the text
   * given, so a file changed meanwhile starts afresh. */
  key: string
  /** Each change, as the whole text. */
  onChange: (text: string) => void
  /** Esc, with nothing picked to let go of first. */
  onDone: () => void
}

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
  /** What it shows; while it is edited, what the editor starts from, and
   * takes in place of what was typed when it changes, as one more step
   * to undo. */
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
  /** Its text is edited in place. */
  edit?: Editor | null
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
  edit,
  className,
}: CodeFileProps) {
  const dark = useDark()
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null)
  const root = useRef<HTMLDivElement | null>(null)
  const editing = edit != null
  // The comment's form sits under the last line picked.
  const under = comment && picked ? Math.max(picked.start, picked.end) : null
  const key = edit?.key
  const items = useMemo<CodeViewItem<undefined>[]>(() => {
    if (key !== undefined) forgetUnlike(key, text)
    return [
      {
        id: ID,
        type: "file",
        file: { name, contents: text },
        ...(under !== null ? { annotations: [{ lineNumber: under }] } : {}),
        ...(key !== undefined ? { edit: true } : {}),
        version: ++counted,
      },
    ]
  }, [name, text, under, key])
  // What the editor is told, as it is now. The view's options are made
  // anew when its callbacks change, which drops a pick under way: they
  // stay the same.
  const told = useRef(edit)
  useEffect(() => {
    told.current = edit
  })
  const keyOf = useCallback(() => told.current?.key, [])
  const changed = useCallback(
    (event: { file: { contents: string } }) =>
      told.current?.onChange(event.file.contents),
    []
  )
  // Turned on here, the editor takes the focus as it comes, at the first
  // line in sight. Drawn anew already editing, as a Pane brought back is,
  // it takes it from what holds it, as its tile, whenever that has it:
  // never from elsewhere.
  const began = useRef(editing)
  useEffect(() => {
    if (!editing) {
      began.current = false
      return
    }
    let anyway = !began.current
    began.current = true
    const around = (at: EventTarget | null) =>
      at instanceof Element && at !== document.body && at.contains(root.current)
    // Until it has the focus: the editor attaches, and draws, a moment
    // after it is made.
    const until = performance.now() + DRAWN_WITHIN
    const first = () => {
      const editor = viewer.current?.getEditor(ID)
      const at = document.activeElement
      if (editor && root.current?.contains(at)) return
      if (editor && (anyway || around(at))) {
        take(editor, anyway)
        anyway = false
      }
      if (performance.now() < until) frame = requestAnimationFrame(first)
    }
    let frame = requestAnimationFrame(first)
    const taken = (event: FocusEvent) => {
      const editor = viewer.current?.getEditor(ID)
      if (editor && around(event.target)) take(editor, false)
    }
    document.addEventListener("focusin", taken)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("focusin", taken)
    }
  }, [editing])
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
      // Lines stay as picked while their comment is written, and the
      // editor picks text, not lines.
      enableLineSelection: under === null && !editing,
      unsafeCSS: CSS,
      itemMetrics: METRICS,
      layout: LAYOUT,
    }),
    [dark, wrap, under, editing]
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

  // Esc lets go of what the editor picked, then is done with it; the
  // search's own field keeps its Esc.
  useEffect(() => {
    const element = root.current
    if (!editing || !element) return
    const done = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (event.composedPath()[0] instanceof HTMLInputElement) return
      const state = viewer.current?.getEditor(ID)?.getViewState()
      const picked = state?.selections ?? []
      const caret = picked.every(
        ({ start, end }) =>
          start.line === end.line && start.character === end.character
      )
      if (picked.length > 1 || !caret) return
      event.stopPropagation()
      told.current?.onDone()
    }
    element.addEventListener("keydown", done, { capture: true })
    return () => element.removeEventListener("keydown", done, { capture: true })
  }, [editing])

  return (
    <WorkerPoolContextProvider
      poolOptions={POOL}
      highlighterOptions={HIGHLIGHTER}
    >
      <EditProvider createEditor={pierreEditor}>
        <CodeView<undefined>
          ref={viewer}
          containerRef={root}
          items={items}
          className={cn(VIEW_CLASS, className)}
          getEditStateKey={keyOf}
          onItemEditChange={changed}
          onItemEditComplete={accept}
          selectedLines={selected}
          onSelectedLinesChange={(selection) =>
            onPick(selection?.range ?? null)
          }
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
      </EditProvider>
    </WorkerPoolContextProvider>
  )
}

/** Forgets the draft and history Pierre keeps for `key` unless it holds
 * `text`: a file changed since starts afresh, as it is on disk. */
function forgetUnlike(key: string, text: string): void {
  const kept = EditStateManager.get("file", key)
  if (kept && kept.document.getText() !== text)
    EditStateManager.clear("file", key)
}

/** Gives `editor` the focus where its caret was, or at the first line in
 * sight when it had none, or `afresh`. */
function take(
  editor: Pick<PierreEditor, "focus" | "getViewState">,
  afresh: boolean
): void {
  const placed = !afresh && !!editor.getViewState().selections?.length
  editor.focus(
    placed
      ? { preventScroll: true }
      : { preventScroll: true, lineNumber: "first-visible" }
  )
}

/** What was typed stays shown as the editor goes. */
const accept = () => "accept" as const

/** Pierre's editor, for the view's text. */
const pierreEditor: EditorFactory<undefined, undefined> = (
  type,
  options,
  key
) => new PierreEditor(type, options, key)

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
