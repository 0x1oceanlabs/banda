/**
 * How a card's status and its colours are drawn (`card.ts`): the sidebar's
 * rows and the counts' list draw them alike.
 */
import { AlarmClockIcon } from "lucide-react"
import { useNow } from "@banda/ui/hooks/use-now"
import { cn } from "@banda/ui/lib/utils"
import { ago, left } from "@banda/ui/lib/words"
import { clock } from "@banda/core/react"
import type { Said, Tone } from "./card"

/** Each tone's colour. */
export const TONES: Readonly<Record<Tone, string>> = {
  attention: "text-attention",
  destructive: "text-destructive",
  added: "text-added",
  plain: "text-foreground",
  muted: "text-muted-foreground",
}

/**
 * What a card's status says: what calls the Person, in its colour; the
 * running turn's timer; how long ago it last changed; when a put-off
 * Thread wakes; or that it woke. Given `stillAt`, as of when its machine
 * was last heard, the timer and how long ago stand as they were then.
 */
export function Status({ said, stillAt }: { said: Said; stillAt?: number }) {
  switch (said.kind) {
    case "word":
      return <Word className={TONES[said.tone]}>{said.word}</Word>
    case "timer":
      return <Timer from={said.from} stillAt={stillAt} />
    case "ago":
      return (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {ago(said.at, stillAt)}
        </span>
      )
    case "later":
      return <Sleeps said={said} />
    case "woke":
      return (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 text-xs font-medium tabular-nums",
            TONES[said.tone]
          )}
          title="Woke from Later"
        >
          <AlarmClockIcon className="size-3" aria-label="Woke" />
          {said.word ?? clock(said.at)}
        </span>
      )
    case "none":
      return null
  }
}

/** When a put-off Thread wakes, and how long is left: "22:40 · 1h",
 * "Fri 09:00 · 12h", "when done" (ADR 0074, decision 6), or "someday",
 * which no time wakes (ADR 0098, decision 12). */
function Sleeps({ said }: { said: Extract<Said, { kind: "later" }> }) {
  const { until, someday } = said
  // A clock only for a time: the other two say the same all along.
  const now = useNow(15_000, until !== undefined)
  const by = said.byAgent ? "Later by its Agent" : "Later"
  const [text, title] = someday
    ? ["someday", `${by}, someday: no time wakes it`]
    : until === undefined
      ? ["when done", `${by}, until it's done`]
      : [`${clock(until, now)} · ${left(until, now)}`, by]
  return (
    <span
      className="shrink-0 text-xs text-muted-foreground tabular-nums"
      title={title}
    >
      {text}
    </span>
  )
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

/** How long the work that runs now has run, ticking each second, or
 * until `stillAt`, standing. */
function Timer({ from, stillAt }: { from: number; stillAt?: number }) {
  const now = useNow(1000, stillAt === undefined)
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
      {elapsed((stillAt ?? now) - from)}
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
