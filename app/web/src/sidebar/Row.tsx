import type { SpaceSummary } from "@bandaso/contract"
import { BandaMark, MARK_WORDS, waits } from "@bandaso/ui/components/banda-mark"
import { ago } from "@bandaso/ui/lib/words"
import { cn } from "@bandaso/ui/lib/utils"
import { useNow } from "@bandaso/ui/hooks/use-now"
import type { Row as Arranged } from "./arrange"
import type { Part, Settings } from "./settings"

/**
 * The built-in layouts (ADR 0008, decision 4). The line with the title is
 * always the mark and the title, so a Thread looks the same in every
 * density; the other lines add context.
 */
export const LAYOUTS: Readonly<Record<number, Part[][]>> = {
  1: [["mark", "title", "~", "space", "status"]],
  2: [
    ["space", "harness", "~", "status"],
    ["mark", "title"],
  ],
  3: [
    ["space", "~", "status"],
    ["mark", "title"],
    ["note", "~", "harness"],
  ],
}

/** One row of the sidebar, its parts laid out as the settings say. */
export function Row({
  row,
  settings,
  inSpace,
  current,
  onOpen,
}: {
  row: Arranged
  settings: Settings
  /** It sits under its Space's header, which already names the Space. */
  inSpace: boolean
  current: boolean
  onOpen: () => void
}) {
  const { lines, hide, layout } = settings.row
  const parts = (layout ?? LAYOUTS[lines] ?? LAYOUTS[3]).map((line) =>
    line.filter(
      (part) => !hide.includes(part) && !(part === "space" && inSpace)
    )
  )
  const one = parts.length === 1
  return (
    <button
      type="button"
      aria-current={current ? "true" : undefined}
      className={cn(
        "flex w-full min-w-0 flex-col gap-0.5 rounded-lg border border-transparent px-2 text-left transition-colors outline-none",
        "hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50",
        one ? "py-1" : "py-1.5",
        current && "border-border bg-background shadow-xs hover:bg-background"
      )}
      onClick={onOpen}
    >
      {parts.map(
        (line, index) =>
          line.length > 0 && (
            <span key={index} className="flex min-w-0 items-center gap-1.5">
              {line.map((part, at) => (
                <Piece key={`${part}${at}`} part={part} row={row} wide={!one} />
              ))}
            </span>
          )
      )}
    </button>
  )
}

function Piece({
  part,
  row,
  wide,
}: {
  part: Part
  row: Arranged
  wide: boolean
}) {
  const { listed, space } = row
  // Nothing waits in it and nothing works: it steps back.
  const quiet =
    row.state === "settled" || (row.state === "active" && !waits(listed.mark))
  switch (part) {
    case "~":
      return <span className="ml-auto" />
    case "mark":
      return (
        <BandaMark
          variant="agent"
          state={listed.mark}
          playful={0}
          label={MARK_WORDS[listed.mark]}
          className={cn("size-4 shrink-0", quiet && "opacity-40")}
        />
      )
    case "title":
      return (
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            quiet ? "text-foreground/75" : "text-foreground"
          )}
        >
          {listed.title}
        </span>
      )
    case "space":
      return (
        <>
          <SpaceBadge space={space} />
          {wide && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {space.name}
            </span>
          )}
        </>
      )
    case "harness":
      return listed.by ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {listed.by}
        </span>
      ) : null
    case "status":
      return <Status row={row} />
    case "note": {
      const text = listed.calls ?? listed.said
      if (!text) return <span className="min-w-0 flex-1" />
      return (
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            listed.calls && listed.mark === "asking"
              ? "text-attention"
              : listed.calls
                ? "text-destructive"
                : "text-muted-foreground"
          )}
        >
          {text}
        </span>
      )
    }
  }
}

/**
 * What calls the Person, in its colour; the running turn's timer; or how
 * long ago it last changed.
 */
function Status({ row }: { row: Arranged }) {
  const { mark, changed, began } = row.listed
  switch (mark) {
    case "asking":
      return <Word className="text-attention">{MARK_WORDS.asking}</Word>
    case "failed":
    case "offline":
      return <Word className="text-destructive">{MARK_WORDS[mark]}</Word>
    case "done":
      return <Word className="text-foreground">{MARK_WORDS.done}</Word>
    case "running":
    case "thinking":
      return began === undefined ? null : <Timer from={began} />
    default:
      return (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {ago(changed)}
        </span>
      )
  }
}

function Word({
  className,
  children,
}: {
  className: string
  children: string
}) {
  return (
    <span className={cn("shrink-0 text-xs font-medium", className)}>
      {children}
    </span>
  )
}

/** How long the work that runs now has run, ticking each second. */
function Timer({ from }: { from: number }) {
  const now = useNow(1000)
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
      {elapsed(now - from)}
    </span>
  )
}

/** `0:41`, `7:05`, `1:02:09`. */
export function elapsed(ms: number): string {
  const all = Math.max(0, Math.floor(ms / 1000))
  const [h, m, s] = [
    Math.floor(all / 3600),
    Math.floor(all / 60) % 60,
    all % 60,
  ]
  const two = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/** Six hues, as Herdr's Spaces have; a Space keeps one by its id. */
const HUES = [350, 25, 85, 160, 210, 280]

/** A Space's badge: its initials on its own hue. */
export function SpaceBadge({ space }: { space: SpaceSummary }) {
  const hue = HUES[hash(space.id) % HUES.length]
  const colour = `oklch(0.6 0.15 ${hue})`
  return (
    <span
      aria-hidden
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm px-0.5 text-[9.5px] leading-none font-bold tracking-wide"
      style={{
        color: colour,
        backgroundColor: `color-mix(in oklab, ${colour} 16%, transparent)`,
      }}
    >
      {initials(space.name)}
    </span>
  )
}

export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)
  const letters =
    words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)
  return letters.toUpperCase()
}

function hash(text: string): number {
  let h = 0
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}
