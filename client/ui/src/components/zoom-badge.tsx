/** A new zoom, in the corner of what it zooms (`useZoom`). */
export function ZoomBadge({ zoom }: { zoom: number | null }) {
  if (zoom === null) return null
  return (
    <div
      role="status"
      aria-label="Zoom"
      className="pointer-events-none absolute top-2 right-3 z-10 rounded-full border bg-popover px-2.5 py-1 text-meta text-popover-foreground shadow-float"
    >
      {Math.round(zoom * 100)}%
    </div>
  )
}
