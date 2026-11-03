/** A Space's badge: its initials on its own hue, as the sidebar, the
 * Banda menu and the bar's lists show a Space. */
import type { SpaceSummary } from "@banda/contract"

/** Six hues, as Herdr's Spaces have; a Space keeps one by its id. */
const HUES = [350, 25, 85, 160, 210, 280]

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

function initials(name: string): string {
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
