/**
 * Files' PDFs (ADR 0073, decision 6), on PDF.js in a module worker of
 * its own, never Chromium's viewer in a frame. The bytes come from the
 * file host in ranges, a chunk as a page needs it, so a large PDF opens
 * at once. Its pages fit the width and are drawn only near the view; the
 * text over each picks and finds as a page's would (Ctrl+F, ⌘F on a
 * Mac). In a wide Pane a column of pages' pictures goes beside them; the
 * zoom and the page shown sit at the foot. In Quick Look it only shows.
 */
import "./pdf.css"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@banda/ui/components/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@banda/ui/components/input-group"
import type { Bytes, PreviewProps } from "@banda/ui/module"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  FileLockIcon,
  FileWarningIcon,
  XIcon,
} from "lucide-react"
import {
  getDocument,
  GlobalWorkerOptions,
  PasswordException,
  PDFDataRangeTransport,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
  TextLayer,
} from "pdfjs-dist"
import jbig2 from "pdfjs-dist/wasm/jbig2.wasm?url"
import openjpeg from "pdfjs-dist/wasm/openjpeg.wasm?url"
import qcms from "pdfjs-dist/wasm/qcms_bg.wasm?url"
import { Card, Loading } from "../Facts"
import { useNear, useWidth } from "./near"
import { ZoomBar } from "./zoom-bar"

GlobalWorkerOptions.workerPort ??= new Worker(
  new URL("./pdf-worker.ts", import.meta.url),
  { type: "module" }
)

/** The decoders PDF.js's worker asks for, as the page serves them: a
 * scan's JPEG 2000, JBIG2 and fax pictures, and colour profiles. */
const WASM: Record<string, string> = {
  "openjpeg.wasm": openjpeg,
  "jbig2.wasm": jbig2,
  "qcms_bg.wasm": qcms,
}

/** What PDF.js's worker asks the page for: only the decoders. A font a
 * PDF names but does not hold is the system's. */
class Decoders {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const url = kind === "wasmUrl" ? WASM[filename] : undefined
    if (!url) throw new Error(`Files carries no ${filename}.`)
    return new Uint8Array(await (await fetch(url)).arrayBuffer())
  }
}

/** How much is read at once: the first chunk opens the PDF, and each
 * page asks for the chunks it lies in. */
const CHUNK = 64 * 1024
/** How much room is left around the pages, in px. */
const PAD = 16
/** PDF.js's 100%: a point of the PDF as a CSS pixel sees it. */
const POINT = 96 / 72
/** The most a page is drawn to fit the width, against 100%. */
const MOST_FIT = 1.5
/** Zoom's steps, and its bounds, against fitting the width. */
const STEP = 1.25
const LEAST_ZOOM = 0.25
const MOST_ZOOM = 6
/** From this width the pages' pictures show beside them, in px. */
const THUMBS_FROM = 640
/** The pictures' width, in px. */
const THUMB = 84

type Size = { width: number; height: number }

type Loaded =
  | { key: string; doc: PDFDocumentProxy; first: Size }
  | { key: string; locked: true }
  | { key: string; broken: string }

/** The PDF at `url`, of `size` bytes, read in ranges by `read`; loaded
 * again as `key` changes. */
function useDocument(
  key: string,
  url: string | null | undefined,
  size: number | null,
  read: PreviewProps["read"]
): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  useEffect(() => {
    if (!url || size === null) return
    let gone = false
    let task: PDFDocumentLoadingTask | undefined
    const open = async () => {
      const first = await read(
        size <= 2 * CHUNK ? undefined : { from: 0, to: CHUNK - 1 }
      )
      if (gone) return
      const source =
        size <= 2 * CHUNK
          ? { data: first }
          : { range: ranges(size, first, read) }
      task = getDocument({
        ...source,
        rangeChunkSize: CHUNK,
        disableAutoFetch: true,
        useWorkerFetch: false,
        BinaryDataFactory: Decoders,
      })
      const doc = await task.promise
      const page = await doc.getPage(1)
      const { width, height } = page.getViewport({ scale: 1 })
      if (!gone) setLoaded({ key, doc, first: { width, height } })
    }
    open().catch((error: unknown) => {
      if (gone) return
      if (error instanceof PasswordException) setLoaded({ key, locked: true })
      else setLoaded({ key, broken: String(error) })
    })
    return () => {
      gone = true
      void task?.destroy()
    }
  }, [key, url, size, read])
  return loaded?.key === key ? loaded : null
}

/** PDF.js's way to the bytes: the first chunk given, the rest read as it
 * asks for them. */
function ranges(
  size: number,
  first: Uint8Array,
  read: (range: Bytes) => Promise<Uint8Array>
): PDFDataRangeTransport {
  const transport = new PDFDataRangeTransport(size, first)
  transport.requestDataRange = (begin: number, end: number) => {
    read({ from: begin, to: end - 1 }).then(
      (bytes) => transport.onDataRange(begin, bytes),
      () => transport.abort()
    )
  }
  return transport
}

export default function PdfView({ file, read, mode }: PreviewProps) {
  const key = `${file.path}\0${file.modified}`
  const loaded = useDocument(key, file.url, file.size, read)
  if (file.url === null)
    return <Card icon={<FileWarningIcon />} title="This PDF cannot be read" />
  if (!loaded) return <Loading />
  if ("locked" in loaded)
    return (
      <Card
        icon={<FileLockIcon />}
        title="This PDF is locked"
        note="It asks for a password, which Files does not take yet."
      />
    )
  if ("broken" in loaded)
    return (
      <Card
        icon={<FileWarningIcon />}
        title="This PDF could not be read"
        note={loaded.broken}
      />
    )
  return (
    <Document key={key} doc={loaded.doc} first={loaded.first} mode={mode} />
  )
}

function Document({
  doc,
  first,
  mode,
}: {
  doc: PDFDocumentProxy
  first: Size
  mode: PreviewProps["mode"]
}) {
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const width = useWidth(box)
  const count = doc.numPages
  const thumbs = mode === "pane" && width >= THUMBS_FROM
  // Each page's size at 100%, as it is read; the first's till then.
  const [sizes, setSizes] = useState<ReadonlyMap<number, Size>>(new Map())
  const sized = useCallback(
    (page: number, size: Size) =>
      setSizes((was) => (was.has(page) ? was : new Map(was).set(page, size))),
    []
  )
  const sizeOf = (page: number) => sizes.get(page) ?? first

  // Fitting the width, and the zoom against it.
  const room = Math.max(0, width - (thumbs ? THUMB + 2 * PAD : 0) - 2 * PAD)
  const fit = Math.min(room / first.width, MOST_FIT * POINT)
  const [zoom, setZoom] = useState(1)
  const scale = Math.max(fit * zoom, 0.1)

  // The page most in view: the first whose middle is below a third of it.
  const [current, setCurrent] = useState(1)
  // Once a frame at most, however fast the wheel turns.
  const looking = useRef(0)
  const onScroll = () => {
    if (looking.current) return
    looking.current = requestAnimationFrame(() => {
      looking.current = 0
      const view = scroller.current
      if (!view) return
      const line = view.scrollTop + view.clientHeight / 3
      let at = 1
      for (const page of view.querySelectorAll<HTMLElement>(
        "[data-pdf-page]"
      )) {
        if (page.offsetTop > line) break
        at = Number(page.dataset.pdfPage)
      }
      setCurrent(at)
    })
  }
  useEffect(() => () => cancelAnimationFrame(looking.current), [])
  const go = (page: number) => {
    const view = scroller.current
    const element = view?.querySelector<HTMLElement>(
      `[data-pdf-page="${page}"]`
    )
    if (view && element) view.scrollTop = element.offsetTop - PAD
  }

  // Find (Ctrl+F): the words, every place they show, and the one now.
  const [find, setFind] = useState<{ query: string; at: number } | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const found = useFound(doc, find?.query ?? "")
  const now = found.length
    ? found[(((find?.at ?? 0) % found.length) + found.length) % found.length]
    : null
  const [drawn, setDrawn] = useState(0)
  const textDrawn = useCallback(() => setDrawn((n) => n + 1), [])
  useHighlights(box, find?.query ?? "", now, drawn)
  // The page of the place found now comes into sight, and is drawn.
  useEffect(() => {
    const view = scroller.current
    const page =
      now && view?.querySelector<HTMLElement>(`[data-pdf-page="${now.page}"]`)
    if (!view || !page) return
    const top = page.offsetTop
    if (
      top + page.offsetHeight < view.scrollTop ||
      top > view.scrollTop + view.clientHeight
    )
      view.scrollTop = top - PAD
  }, [now])

  return (
    <div
      ref={box}
      className="relative flex min-h-0 flex-1 bg-muted/40"
      onKeyDown={(event) => {
        const primary = event.ctrlKey || event.metaKey
        if (
          mode !== "pane" ||
          !primary ||
          event.altKey ||
          event.shiftKey ||
          event.code !== "KeyF"
        )
          return
        event.preventDefault()
        setFind((was) => was ?? { query: "", at: 0 })
        field.current?.select()
      }}
    >
      {thumbs && (
        <Thumbs
          doc={doc}
          count={count}
          sizeOf={sizeOf}
          current={current}
          onGo={go}
        />
      )}
      <div
        ref={scroller}
        tabIndex={0}
        aria-label="Pages"
        onScroll={onScroll}
        className="min-h-0 min-w-0 flex-1 overflow-auto outline-none"
      >
        <div
          className="flex w-max min-w-full flex-col items-center gap-3"
          style={{ padding: PAD }}
        >
          {Array.from({ length: count }, (_, n) => (
            <Page
              key={n + 1}
              doc={doc}
              number={n + 1}
              size={sizeOf(n + 1)}
              scale={scale}
              scroller={scroller}
              onSize={sized}
              onText={textDrawn}
            />
          ))}
        </div>
      </div>
      {mode === "pane" && (
        <ZoomBar
          scale={`${Math.round((scale / POINT) * 100)}%`}
          title="Fit the width"
          onOut={() => setZoom((z) => Math.max(LEAST_ZOOM, z / STEP))}
          onIn={() => setZoom((z) => Math.min(MOST_ZOOM, z * STEP))}
          onFit={() => setZoom(1)}
        >
          <span
            aria-label="Page"
            className="min-w-14 px-1 text-center tabular-nums"
          >
            {current} / {count}
          </span>
          <span aria-hidden className="mx-0.5 h-3.5 w-px bg-foreground/10" />
        </ZoomBar>
      )}
      {find && (
        <FindBar
          field={field}
          query={find.query}
          count={found.length}
          current={now ? found.indexOf(now) : 0}
          onQuery={(query) => setFind({ query, at: 0 })}
          onStep={(by) => setFind({ ...find, at: find.at + by })}
          onClose={() => {
            setFind(null)
            scroller.current?.focus()
          }}
        />
      )}
    </div>
  )
}

/** One page: its place always, its picture and its text only near the
 * view, drawn again at a new scale. */
function Page({
  doc,
  number,
  size,
  scale,
  scroller,
  onSize,
  onText,
}: {
  doc: PDFDocumentProxy
  number: number
  size: Size
  scale: number
  scroller: React.RefObject<HTMLDivElement | null>
  onSize: (page: number, size: Size) => void
  onText: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const near = useNear(box, scroller, "100% 0px")
  const page = usePage(doc, number, near)
  useEffect(() => {
    if (!page) return
    const { width, height } = page.getViewport({ scale: 1 })
    onSize(number, { width, height })
  }, [page, number, onSize])
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  // Drawn a moment after the scale rests, so a zoom draws once.
  const settled = useSettled(scale, 120)
  useEffect(() => {
    const picture = canvas.current
    const layer = text.current
    if (!near || !page || !picture || !layer) return
    const viewport = page.getViewport({ scale: settled })
    const ratio = window.devicePixelRatio || 1
    picture.width = Math.floor(viewport.width * ratio)
    picture.height = Math.floor(viewport.height * ratio)
    const drawing = page.render({
      canvas: picture,
      viewport,
      ...(ratio !== 1 && { transform: [ratio, 0, 0, ratio, 0, 0] }),
    })
    drawing.promise.catch(() => undefined)
    layer.replaceChildren()
    const words = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: layer,
      viewport,
    })
    words.render().then(onText, () => undefined)
    return () => {
      drawing.cancel()
      words.cancel()
    }
  }, [near, page, settled, onText])
  return (
    <div
      ref={box}
      data-pdf-page={number}
      aria-label={`Page ${number}`}
      className="relative shrink-0 overflow-hidden rounded-small bg-white shadow-[0_4px_18px_rgb(0_0_0/0.18)]"
      style={
        {
          width: size.width * scale,
          height: size.height * scale,
          "--total-scale-factor": scale,
        } as React.CSSProperties
      }
    >
      {near && (
        <>
          <canvas ref={canvas} className="absolute inset-0 size-full" />
          <div ref={text} data-pdf-text="" />
        </>
      )}
    </div>
  )
}

/** The pages' pictures, small, in a column: the one shown ringed, a click
 * goes to one. */
function Thumbs({
  doc,
  count,
  sizeOf,
  current,
  onGo,
}: {
  doc: PDFDocumentProxy
  count: number
  sizeOf: (page: number) => Size
  current: number
  onGo: (page: number) => void
}) {
  const column = useRef<HTMLDivElement>(null)
  // The one shown stays in sight.
  useEffect(() => {
    column.current
      ?.querySelector(`[data-thumb="${current}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [current])
  return (
    <nav
      ref={column}
      aria-label="Pages' pictures"
      className="flex shrink-0 flex-col items-center gap-3 overflow-y-auto border-r"
      style={{ width: THUMB + 2 * PAD, padding: PAD }}
    >
      {Array.from({ length: count }, (_, n) => (
        <Thumb
          key={n + 1}
          doc={doc}
          number={n + 1}
          size={sizeOf(n + 1)}
          on={n + 1 === current}
          column={column}
          onGo={onGo}
        />
      ))}
    </nav>
  )
}

function Thumb({
  doc,
  number,
  size,
  on,
  column,
  onGo,
}: {
  doc: PDFDocumentProxy
  number: number
  size: Size
  on: boolean
  column: React.RefObject<HTMLDivElement | null>
  onGo: (page: number) => void
}) {
  const box = useRef<HTMLButtonElement>(null)
  const near = useNear(box, column, "200px 0px")
  const page = usePage(doc, number, near)
  const canvas = useRef<HTMLCanvasElement>(null)
  const scale = THUMB / size.width
  useEffect(() => {
    const picture = canvas.current
    if (!page || !picture) return
    const viewport = page.getViewport({ scale: scale * 2 })
    picture.width = Math.floor(viewport.width)
    picture.height = Math.floor(viewport.height)
    const drawing = page.render({ canvas: picture, viewport })
    drawing.promise.catch(() => undefined)
    return () => drawing.cancel()
  }, [page, scale])
  return (
    <button
      ref={box}
      type="button"
      data-thumb={number}
      aria-label={`Go to page ${number}`}
      aria-current={on ? "page" : undefined}
      onClick={() => onGo(number)}
      className="relative shrink-0 overflow-hidden rounded-small bg-white opacity-70 ring-offset-2 ring-offset-transparent transition-opacity outline-none hover:opacity-100 aria-[current=page]:opacity-100 aria-[current=page]:ring-2 aria-[current=page]:ring-focus"
      style={{ width: THUMB, height: size.height * scale }}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
    </button>
  )
}

/** Page `number` of `doc`, once it is `near`: PDF.js reads its part of
 * the file then. */
function usePage(
  doc: PDFDocumentProxy,
  number: number,
  near: boolean
): PDFPageProxy | null {
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  useEffect(() => {
    if (!near || page) return
    let gone = false
    doc.getPage(number).then(
      (page) => gone || setPage(page),
      () => undefined
    )
    return () => {
      gone = true
    }
  }, [doc, number, near, page])
  return page
}

/** `value`, once it has rested for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/** Where words show in a PDF: a page, and which of its places. */
type Place = { page: number; nth: number }

/** Each page's text, as its text layer writes it, by its document. */
const TEXTS = new WeakMap<PDFDocumentProxy, Map<number, Promise<string>>>()

function textOf(doc: PDFDocumentProxy, page: number): Promise<string> {
  let texts = TEXTS.get(doc)
  if (!texts) TEXTS.set(doc, (texts = new Map()))
  let text = texts.get(page)
  if (!text) {
    text = doc
      .getPage(page)
      .then((page) => page.getTextContent())
      .then(({ items }) =>
        items.map((item) => ("str" in item ? item.str : "")).join("")
      )
    texts.set(page, text)
  }
  return text
}

/** Where `query` shows, in any case, page by page. */
function useFound(doc: PDFDocumentProxy, query: string): Place[] {
  const [found, setFound] = useState<{ query: string; places: Place[] }>()
  useEffect(() => {
    const wanted = query.toLowerCase()
    if (!wanted) return
    let gone = false
    const timer = setTimeout(async () => {
      const pages = Array.from({ length: doc.numPages }, (_, n) => n + 1)
      const texts = await Promise.all(
        pages.map((page) => textOf(doc, page).catch(() => ""))
      )
      const places: Place[] = []
      texts.forEach((text, n) => {
        const lower = text.toLowerCase()
        let nth = 0
        for (
          let at = lower.indexOf(wanted);
          at >= 0;
          at = lower.indexOf(wanted, at + wanted.length)
        )
          places.push({ page: n + 1, nth: nth++ })
      })
      if (!gone) setFound({ query, places })
    }, 120)
    return () => {
      gone = true
      clearTimeout(timer)
    }
  }, [doc, query])
  return query && found?.query === query ? found.places : []
}

/** Marks where `query` shows on the pages drawn, and `now` the more;
 * scrolls `now` into sight once its page's text is drawn. */
function useHighlights(
  box: React.RefObject<HTMLElement | null>,
  query: string,
  now: Place | null,
  drawn: number
) {
  useEffect(() => {
    const root = box.current
    const wanted = query.toLowerCase()
    if (!root || !wanted || typeof CSS === "undefined" || !CSS.highlights)
      return
    const all = new Highlight()
    const shown = new Highlight()
    for (const layer of root.querySelectorAll<HTMLElement>("[data-pdf-text]")) {
      const page = Number(
        layer.closest<HTMLElement>("[data-pdf-page]")?.dataset.pdfPage
      )
      rangesOf(layer, wanted).forEach((range, nth) => {
        all.add(range)
        if (now?.page === page && now.nth === nth) {
          shown.add(range)
          range.startContainer.parentElement?.scrollIntoView({
            block: "center",
            inline: "nearest",
          })
        }
      })
    }
    CSS.highlights.set("pdf-found", all)
    CSS.highlights.set("pdf-found-now", shown)
    return () => {
      CSS.highlights.delete("pdf-found")
      CSS.highlights.delete("pdf-found-now")
    }
  }, [box, query, now, drawn])
}

/** Where `wanted`, in lower case, shows in the text of `layer`, as its
 * text nodes hold it. */
function rangesOf(layer: HTMLElement, wanted: string): Range[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    nodes.push(node as Text)
  const text = nodes
    .map((node) => node.data)
    .join("")
    .toLowerCase()
  // Where each node starts in the text.
  const starts: number[] = []
  let length = 0
  for (const node of nodes) {
    starts.push(length)
    length += node.data.length
  }
  const pointAt = (at: number): [Text, number] => {
    let index = starts.length - 1
    while (index > 0 && starts[index] > at) index--
    return [nodes[index], at - starts[index]]
  }
  const ranges: Range[] = []
  for (
    let at = text.indexOf(wanted);
    at >= 0;
    at = text.indexOf(wanted, at + wanted.length)
  ) {
    const range = document.createRange()
    range.setStart(...pointAt(at))
    range.setEnd(...pointAt(at + wanted.length - 1))
    range.setEnd(range.endContainer, range.endOffset + 1)
    ranges.push(range)
  }
  return ranges
}

/** Find in the PDF, on top of it as the Thread's: the words, how many
 * show and which is the one now, Previous and Next. Enter goes on,
 * Shift+Enter back, Escape closes it. */
function FindBar({
  field,
  query,
  count,
  current,
  onQuery,
  onStep,
  onClose,
}: {
  field: React.RefObject<HTMLInputElement | null>
  query: string
  count: number
  current: number
  onQuery: (query: string) => void
  onStep: (by: 1 | -1) => void
  onClose: () => void
}) {
  return (
    <div className="absolute top-2 right-4 z-10 w-72 max-w-[calc(100%-2rem)] rounded-card bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
      <InputGroup className="h-9 border-transparent bg-transparent has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:bg-transparent">
        <InputGroupInput
          ref={field}
          value={query}
          autoFocus
          placeholder="Find in PDF"
          aria-label="Find in PDF"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation()
              onClose()
            }
            if (event.key === "Enter") {
              event.preventDefault()
              onStep(event.shiftKey ? -1 : 1)
            }
          }}
        />
        <InputGroupAddon align="inline-end" className="gap-0.5">
          <span
            aria-live="polite"
            className="px-1 text-xs font-normal tabular-nums"
          >
            {!query
              ? ""
              : count === 0
                ? "No results"
                : `${current + 1} of ${count}`}
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Previous match"
            disabled={count === 0}
            onClick={() => onStep(-1)}
          >
            <ChevronUpIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Next match"
            disabled={count === 0}
            onClick={() => onStep(1)}
          >
            <ChevronDownIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Close find"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
