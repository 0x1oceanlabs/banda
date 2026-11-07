/**
 * Files' pictures (ADR 0073, decision 6): an `<img>` from the file host,
 * an SVG too and never inlined, fitting the Pane. The wheel or a pinch
 * zooms where the pointer is, a drag pans, a double click fits it again;
 * a small readout says its scale against its own pixels. In Quick Look
 * it fits, and the arrows' next picture fits again. One Chromium cannot
 * draw shows its facts.
 */
import { useEffect, useRef, useState, type PointerEvent } from "react"
import { Spinner } from "@banda/ui/components/spinner"
import type { PreviewProps } from "@banda/ui/module"
import { Facts } from "../Facts"
import { FIT, percentOf, wheelFactor, type Zoom, zoomAt } from "../zoom"
import { ZoomBar } from "./zoom-bar"

/** The most it zooms in, against its own pixels: 16 times. */
const MOST = 16
/** A button's step. */
const STEP = 1.25
/** Behind a picture's clear parts: a quiet check, as an editor draws. */
const CHECKS =
  "repeating-conic-gradient(color-mix(in srgb, var(--foreground) 6%, transparent) 0 25%, transparent 0 50%) 0 0 / 16px 16px"

export default function ImageView({ file }: PreviewProps) {
  // The URL that could not be drawn, if any.
  const [broken, setBroken] = useState<string | null>(null)
  if (file.url === null || (file.url && file.url === broken))
    return <Facts stat={file} note="This image could not be drawn." />
  return (
    <Picture
      // A new picture fits anew.
      key={file.path}
      url={file.url}
      name={file.name}
      onBroken={() => setBroken(file.url ?? null)}
    />
  )
}

function Picture({
  url,
  name,
  onBroken,
}: {
  url: string | undefined
  name: string
  onBroken: () => void
}) {
  const stage = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const [zoom, setZoom] = useState(FIT)
  // The size that fits the Pane, against its own pixels.
  const [fit, setFit] = useState<number | null>(null)
  const drag = useRef<{ x: number; y: number; from: Zoom } | null>(null)

  const most = fit ? Math.max(1, MOST / fit) : 1

  // The wheel zooms, and keeps the page from scrolling: React's listener
  // cannot stop it.
  useEffect(() => {
    const element = stage.current
    if (!element || !fit) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const point = pointIn(element, event.clientX, event.clientY)
      const factor = wheelFactor(event.deltaY, event.ctrlKey)
      setZoom((zoom) => zoomAt(zoom, factor, point, most))
    }
    element.addEventListener("wheel", wheel, { passive: false })
    return () => element.removeEventListener("wheel", wheel)
  }, [fit, most])

  // Measured as it loads, and as the Pane changes size.
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      const shown = fitOf(image.current)
      if (shown) setFit(shown)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const step = (by: number) =>
    setZoom((zoom) => zoomAt(zoom, by, { x: 0, y: 0 }, most))
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, from: zoom }
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const from = drag.current
    if (!from) return
    setZoom({
      ...from.from,
      x: from.from.x + event.clientX - from.x,
      y: from.from.y + event.clientY - from.y,
    })
  }
  const up = () => {
    drag.current = null
  }
  const real = (fit ?? 1) * zoom.scale
  return (
    <div
      ref={stage}
      className="relative flex min-h-0 flex-1 cursor-grab touch-none items-center justify-center overflow-hidden p-6 select-none active:cursor-grabbing"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => setZoom(FIT)}
    >
      {url === undefined ? (
        <Spinner className="text-muted-foreground" />
      ) : (
        <img
          ref={image}
          src={url}
          alt={name}
          draggable={false}
          onLoad={() => setFit(fitOf(image.current))}
          onError={onBroken}
          style={{
            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
            background: CHECKS,
            // Its own pixels, large, stay sharp squares.
            imageRendering: real >= 2 ? "pixelated" : undefined,
          }}
          className="max-h-full max-w-full object-contain"
        />
      )}
      {fit !== null && (
        <ZoomBar
          scale={percentOf(fit, zoom)}
          title="Double-click the picture to fit it"
          onOut={() => step(1 / STEP)}
          onIn={() => step(STEP)}
        />
      )}
    </div>
  )
}

/** How big `image` is drawn whole, against its own pixels; none before
 * it loads. */
function fitOf(image: HTMLImageElement | null): number | null {
  return image?.naturalWidth ? image.offsetWidth / image.naturalWidth : null
}

/** Where the pointer at `x`, `y` is in `element`, from its middle. */
function pointIn(element: HTMLElement, x: number, y: number) {
  const box = element.getBoundingClientRect()
  return { x: x - box.left - box.width / 2, y: y - box.top - box.height / 2 }
}
