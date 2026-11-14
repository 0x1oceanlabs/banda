/**
 * How a card's time is drawn (`card.ts`, spec §2.5): short and still,
 * "now", "14m", "2h", "3d", "Mar 3"; put off, when it wakes, "18:30",
 * "Tue 9:00", "Mar 3", "someday" or "when done"; at a usage limit, when
 * its Agent goes on, "15:00". Nothing ticks by the second: one timer
 * draws the cards again as each minute begins (`useMinute`). A call's time takes its colour, the only colour on a card but
 * its mark's (ADR 0098, decision 8).
 */
import { COLOR_CLASS } from "@banda/ui/components/banda-mark"
import { cn } from "@banda/ui/lib/utils"
import { short, wakes } from "@banda/ui/lib/words"
import type { Quiet, Time, Tone } from "./card"

/** Each call's colour, as the Mark's; woke's yellow darker on a light
 * theme, where it is small text. */
export const TONES: Readonly<Record<Tone, string>> = {
  ...COLOR_CLASS,
  woke: "text-woke-text",
}

/** How muted a quiet card's time is: work and the Archive a step more
 * than Later, whose time says when it wakes. */
const QUIET: Readonly<Record<Quiet, string>> = {
  working: "text-muted-foreground/60",
  later: "text-muted-foreground/70",
  archived: "text-muted-foreground/60",
}

/** What `time` says at `now`. */
export function timeWords(time: Time, now: number): string {
  switch (time.kind) {
    case "ago":
      return short(time.at, now)
    case "wakes":
    case "goes on":
      return wakes(time.at, now)
    case "someday":
      return "someday"
    case "when done":
      return "when done"
  }
}

/** A card's time at `now`: in its call's colour, or muted, more so on a
 * quiet card. */
export function CardTime({
  time,
  now,
  quiet,
}: {
  time: Time
  now: number
  quiet?: Quiet
}) {
  const tone = time.kind === "ago" ? time.tone : undefined
  return (
    <span
      data-time=""
      className={cn(
        "shrink-0 text-meta tabular-nums",
        tone
          ? cn("font-medium", TONES[tone])
          : quiet
            ? QUIET[quiet]
            : "text-muted-foreground"
      )}
    >
      {timeWords(time, now)}
    </span>
  )
}
