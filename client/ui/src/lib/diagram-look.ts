/**
 * Mermaid's colours from the look's own: a diagram an Agent draws sits on
 * the window's ground in its ink, not on Mermaid's stock white or navy.
 * Mermaid takes only plain colours, so the look's tokens are first
 * resolved to hex, then mixed here as the card's CSS mixes them.
 */
import { useMemo, useSyncExternalStore } from "react"
import { BANDA } from "@banda/contract/look"

type Rgb = readonly [number, number, number]

/** How much ink each part of a diagram takes over the ground. */
const INK = { surface: 0.035, node: 0.07, line: 0.18, edge: 0.55 } as const

function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`
}

/** `ink` laid over `ground` at `amount`, in sRGB as `color-mix` does. */
export function mix(ground: Rgb, ink: Rgb, amount: number): string {
  const at = (i: 0 | 1 | 2) => ground[i] + (ink[i] - ground[i]) * amount
  return hex([at(0), at(1), at(2)])
}

/** Mermaid's config for a diagram in `ink` on `ground`, its words in
 * `font` at `size`, the UI level's. */
export function diagramConfig(
  ground: Rgb,
  ink: Rgb,
  font: string,
  dark: boolean,
  size: string = BANDA.light["ui-size"]
) {
  const text = hex(ink)
  const surface = mix(ground, ink, INK.surface)
  const node = mix(ground, ink, INK.node)
  const line = mix(ground, ink, INK.line)
  const edge = mix(ground, ink, INK.edge)
  return {
    theme: "base",
    fontFamily: font,
    flowchart: { curve: "basis" },
    themeVariables: {
      darkMode: dark,
      fontFamily: font,
      fontSize: size,
      background: surface,
      textColor: text,
      titleColor: text,
      lineColor: edge,
      primaryColor: node,
      primaryTextColor: text,
      primaryBorderColor: line,
      secondaryColor: node,
      secondaryTextColor: text,
      secondaryBorderColor: line,
      tertiaryColor: surface,
      tertiaryTextColor: text,
      tertiaryBorderColor: line,
      mainBkg: node,
      nodeBorder: line,
      clusterBkg: surface,
      clusterBorder: line,
      edgeLabelBackground: surface,
      noteBkgColor: node,
      noteTextColor: text,
      noteBorderColor: line,
      actorBkg: node,
      actorBorder: line,
      actorTextColor: text,
      actorLineColor: edge,
      signalColor: edge,
      signalTextColor: text,
      labelBoxBkgColor: node,
      labelBoxBorderColor: line,
      labelTextColor: text,
      loopTextColor: text,
      activationBkgColor: node,
      activationBorderColor: line,
      sequenceNumberColor: hex(ground),
    },
  }
}

let paint: CanvasRenderingContext2D | null | undefined

/** Any CSS colour, `oklch` too, as the browser paints it. */
function rgbOf(color: string, fallback: Rgb): Rgb {
  // Rendered away from a page, as on the server, there is no canvas.
  if (typeof document === "undefined") return fallback
  paint ??= document.createElement("canvas").getContext("2d", {
    willReadFrequently: true,
  })
  if (!paint || !color) return fallback
  paint.clearRect(0, 0, 1, 1)
  paint.fillStyle = "#000"
  paint.fillStyle = color
  paint.fillRect(0, 0, 1, 1)
  const [r, g, b] = paint.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

function subscribe(changed: () => void) {
  const watch = new MutationObserver(changed)
  watch.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  })
  return () => watch.disconnect()
}

/** The tokens a diagram is drawn from, as one string to compare. */
function tokens(): string {
  const root = document.documentElement
  const style = getComputedStyle(root)
  return [
    style.getPropertyValue("--background").trim(),
    style.getPropertyValue("--foreground").trim(),
    getComputedStyle(document.body).fontFamily,
    root.classList.contains("dark") ? "dark" : "light",
    style.getPropertyValue("--ui-size").trim(),
  ].join("|")
}

/** Mermaid's config in the look now, again whenever the look changes,
 * and the look's tokens it was drawn from, as one string. */
export function useDiagramLook() {
  const look = useSyncExternalStore(subscribe, tokens, () => "")
  const config = useMemo(() => {
    const [ground, ink, font, scheme, size] = look.split("|")
    const dark = scheme === "dark"
    return diagramConfig(
      rgbOf(ground ?? "", dark ? [10, 10, 10] : [255, 255, 255]),
      rgbOf(ink ?? "", dark ? [250, 250, 250] : [10, 10, 10]),
      font || "sans-serif",
      dark,
      size || undefined
    )
  }, [look])
  return { config, look }
}
