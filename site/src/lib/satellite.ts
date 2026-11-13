// A sub-agent's sign in its row: the Mark's grammar without eyes, its
// shape its state (ADR 0103). Drawn at build and by the window's loop.

export type SatelliteState = "working" | "asks" | "failed" | "done"

const OCTAGON = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2 + Math.PI / 8
  return `${(6 + 5.3 * Math.cos(a)).toFixed(2)},${(6 + 5.3 * Math.sin(a)).toFixed(2)}`
}).join(" ")

const BODY: Record<SatelliteState, string> = {
  working:
    '<circle cx="6" cy="6" r="4.6" style="fill:color-mix(in oklab,var(--foreground) 45%,transparent)"/>',
  asks: '<path d="M6 1.9 10.5 9.9H1.5Z" style="fill:var(--attention);stroke:var(--attention)" stroke-width="1.6" stroke-linejoin="round"/>',
  failed: `<polygon points="${OCTAGON}" style="fill:var(--destructive)"/>`,
  done: '<rect x="1.6" y="1.6" width="8.8" height="8.8" rx="2.4" style="fill:color-mix(in oklab,var(--foreground) 70%,transparent)"/>',
}

export function satelliteSvg(state: SatelliteState, size = 10) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 12 12" aria-hidden="true">${BODY[state]}</svg>`
}
