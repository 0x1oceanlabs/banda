/**
 * Files' hex (ADR 0073, decision 6): any file's bytes, for one nothing
 * else draws. Its facts sit on top, with its app a click away, as for a
 * file Chromium cannot draw; under them its rows, 16 bytes each, with
 * their offset and the same as text. The bytes come from the file host
 * in ranges as the rows scroll into view, so a file of any size opens at
 * once. Ctrl+G (⌘G) goes to an offset; a click on a byte marks it.
 */
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { Button } from "@banda/ui/components/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@banda/ui/components/input-group"
import {
  VirtualList,
  type VirtualListHandle,
} from "@banda/ui/components/virtual-list"
import { matches } from "@banda/ui/lib/keys"
import { openWithSystem } from "@banda/ui/lib/outside"
import { cn } from "@banda/ui/lib/utils"
import type { PreviewProps } from "@banda/ui/module"
import { AppWindowIcon, BinaryIcon, XIcon } from "lucide-react"
import {
  charOf,
  hexOf,
  offsetDigits,
  offsetText,
  parseOffset,
  ROW,
} from "../hex"
import { kindWords, sizeWords } from "../words"
import { useRuns } from "./runs"

/** How many bytes are read at once, and how many such pages are kept. */
const PAGE = 64 * 1024
const KEPT = 64
/** A row's height, in px. */
const HEIGHT = 20
/** Goes to an offset, as an editor's Go to Line. */
const GO_KEY = { code: "KeyG", primary: true }

/** The bytes of `file` read in pages as rows ask for them: a byte, or
 * none while its page is read; and how to ask for rows. */
function usePages(file: PreviewProps["file"], read: PreviewProps["read"]) {
  const size = file.size ?? 0
  const reader = useRef(read)
  useEffect(() => {
    reader.current = read
  })
  // Another file, or this one changed: read again.
  const pages = useRuns<Uint8Array>(`${file.path}\0${file.modified}`, KEPT)
  const ready = file.url !== undefined && pages.current
  const { want: wantPage, get } = pages

  const want = useCallback(
    (first: number, last: number) => {
      if (!ready) return
      const from = Math.floor((first * ROW) / PAGE)
      const to = Math.floor(Math.min(size - 1, last * ROW + ROW - 1) / PAGE)
      for (let page = from; page <= to; page++) {
        const end = Math.min(size, (page + 1) * PAGE) - 1
        wantPage(page, () => reader.current({ from: page * PAGE, to: end }))
      }
    },
    [ready, size, wantPage]
  )
  const byte = (offset: number): number | undefined =>
    get(Math.floor(offset / PAGE))?.[offset % PAGE]
  return { byte, want }
}

export default function HexView({ file, read, mode, local }: PreviewProps) {
  const size = file.size ?? 0
  const rows = Math.ceil(size / ROW)
  const digits = offsetDigits(size)
  const { byte, want } = usePages(file, read)
  const list = useRef<VirtualListHandle>(null)
  // The byte marked, of one file.
  const [mark, setMark] = useState<{ path: string; offset: number } | null>(
    null
  )
  const marked = mark?.path === file.path ? mark.offset : null
  const setMarked = (offset: number) => setMark({ path: file.path, offset })
  const [going, setGoing] = useState(false)
  const [lost, setLost] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)

  const go = (text: string) => {
    const offset = parseOffset(text)
    if (offset === null) return setLost("Not an offset")
    if (offset >= size) return setLost(`Past the end, ${sizeWords(size)}`)
    setGoing(false)
    setLost(null)
    setMarked(offset)
    list.current?.scrollTo(Math.floor(offset / ROW), "center")
    list.current?.focus()
  }

  const cell = (
    offset: number,
    text: string | undefined,
    kind: "hex" | "char"
  ) => (
    <span
      key={`${kind}${offset}`}
      data-offset={offset}
      className={cn(
        "rounded-small",
        kind === "hex" ? "w-[2ch]" : "w-[1ch]",
        (text === undefined || text === "·") && "text-muted-foreground/40",
        marked === offset && "bg-primary/20 text-foreground"
      )}
    >
      {text ?? (kind === "hex" ? "··" : " ")}
    </span>
  )

  const row = (index: number, style: CSSProperties) => {
    const start = index * ROW
    const hex: React.ReactNode[] = []
    const chars: React.ReactNode[] = []
    for (let n = 0; n < ROW; n++) {
      const offset = start + n
      if (offset >= size) break
      const value = byte(offset)
      hex.push(
        cell(offset, value === undefined ? undefined : hexOf(value), "hex")
      )
      if (n === 7) hex.push(<span key="gap" className="w-[1ch]" />)
      chars.push(
        cell(offset, value === undefined ? undefined : charOf(value), "char")
      )
    }
    return (
      <div
        data-row={index}
        style={style}
        className="flex items-center gap-[2ch] px-3 whitespace-pre"
      >
        <span className="text-muted-foreground tabular-nums">
          {offsetText(start, digits)}
        </span>
        <span className="flex gap-[1ch]">{hex}</span>
        <span className="flex">{chars}</span>
      </div>
    )
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (mode !== "pane" || !matches(event.nativeEvent, GO_KEY)) return
        event.preventDefault()
        setGoing(true)
        setLost(null)
        requestAnimationFrame(() => field.current?.select())
      }}
    >
      <HexFacts
        file={file}
        local={local}
        marked={marked}
        byte={marked === null ? undefined : byte(marked)}
      />
      <VirtualList
        ref={list}
        aria-label="Bytes"
        tabIndex={0}
        count={rows}
        rowHeight={HEIGHT}
        row={row}
        onRange={want}
        header={
          <div
            aria-hidden
            className="flex h-6 items-center gap-[2ch] border-b bg-background px-3 whitespace-pre text-muted-foreground"
          >
            <span>{"Offset".padEnd(digits)}</span>
            <span className="flex gap-[1ch]">
              {Array.from({ length: ROW }, (_, n) => (
                <span key={n} className="w-[2ch]">
                  {hexOf(n)}
                  {n === 7 && " "}
                </span>
              ))}
            </span>
            <span>Text</span>
          </div>
        }
        // The offset, the bytes in two eights, the text, and the gaps.
        width={`calc(${digits + 69}ch + 1.5rem)`}
        onClick={(event) => {
          const at = (event.target as HTMLElement).closest<HTMLElement>(
            "[data-offset]"
          )
          if (at) setMarked(Number(at.dataset.offset))
        }}
        className="flex-1 font-mono text-xs outline-none select-text"
      />
      {going && (
        <div className="absolute top-12 right-4 z-20 w-64 max-w-[calc(100%-2rem)] rounded-card bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
          <InputGroup className="h-9 border-transparent bg-transparent has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:bg-transparent">
            <InputGroupInput
              ref={field}
              autoFocus
              placeholder="Offset, as 4096 or 0x1000"
              aria-label="Go to offset"
              onChange={() => setLost(null)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation()
                  setGoing(false)
                  list.current?.focus()
                }
                if (event.key === "Enter") {
                  event.preventDefault()
                  go(event.currentTarget.value)
                }
              }}
            />
            <InputGroupAddon align="inline-end" className="gap-0.5">
              {lost && (
                <span role="alert" className="px-1 text-xs font-normal">
                  {lost}
                </span>
              )}
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Close go to offset"
                onClick={() => setGoing(false)}
              >
                <XIcon />
              </Button>
            </InputGroupAddon>
          </InputGroup>
        </div>
      )}
    </div>
  )
}

/** The file's facts in a line, and its app; the byte marked, where one
 * is. */
function HexFacts({
  file,
  local,
  marked,
  byte,
}: {
  file: PreviewProps["file"]
  local: PreviewProps["local"]
  marked: number | null
  byte: number | undefined
}) {
  const outside = local?.(file.path)
  const kind = kindWords({ path: file.path, kind: "file", mime: file.mime })
  const facts = [
    kind,
    file.mime,
    file.size === null
      ? null
      : `${sizeWords(file.size)}${file.size >= 1000 ? ` (${file.size.toLocaleString("en")} bytes)` : ""}`,
  ].filter(Boolean)
  return (
    <div
      aria-label="Facts"
      className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground"
    >
      <BinaryIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{facts.join(" · ")}</span>
      {marked !== null && (
        <span
          aria-label="Marked byte"
          className="shrink-0 font-mono tabular-nums"
        >
          0x{marked.toString(16)} ({marked.toLocaleString("en")})
          {byte !== undefined && ` = ${hexOf(byte)}`}
        </span>
      )}
      {outside && (
        <Button
          size="xs"
          variant="ghost"
          className="shrink-0 text-muted-foreground"
          onClick={() => openWithSystem(outside)}
        >
          <AppWindowIcon />
          Open in its app
        </Button>
      )}
    </div>
  )
}
