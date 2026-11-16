// Draws the menu bar's icons on macOS (ADR 0086, decision 4) from Banda's
// mark, as the accepted mock draws them (mac-menubar-v1): the tiles and
// the hat tipped -8° about (54, 45), each hat's shape and eyes, at 16 px
// and twice that. The mark's own geometry is client/ui's banda-mark.tsx.
// Run it again after a change, with resvg on the PATH:
//
//   node client/desktop/icons/menu-bar/draw.mjs
//
// Black is a template's (`Template`): macOS draws it in the menu bar's,
// or the menu's, own colour. Colour is drawn only where the mock shows it:
// a hat that asks, in light and dark menu bars, and the marks of rows that
// ask, failed or are done.
//
// Linux and Windows have no templates, so `tray/` holds each of the menu
// bar's five signs twice, named as the two asking hats here are, by the
// bar it sits on: `tray/<sign>-dark` is for a dark bar, in light ink, and
// `tray/<sign>-light` for a light one, in dark ink. Each is a square:
// `.png` (16 px) and `@2x.png` for Linux, and for Windows an `.ico` that
// holds 16, 20, 24 and 32 px, for 100 to 200%.
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const here = import.meta.dirname

/** The mock's colours: the menu bar's own, and banda-light's and
 * banda-dark's attention, added and destructive. */
const BAR = { light: "rgba(0,0,0,.84)", dark: "rgba(255,255,255,.92)" }
const ATTENTION = { light: "#e5590a", dark: "#ff8a3d" }
const ADDED = "#15803d"
const DESTRUCTIVE = "#e7000b"
const WOKE = "#f5c542"

const TILES =
  '<rect x="0" y="0" width="42" height="100" rx="15"/>' +
  '<rect x="52" y="55" width="48" height="45" rx="15"/>'
const TIP = 'transform="rotate(-8 54 45)"'

/** The holes a hat's eyes make, as a mask in its own turned space. */
const mask = (id, eyes) =>
  `<mask id="${id}" maskUnits="userSpaceOnUse" x="-20" y="-40" width="160" height="160">` +
  `<rect x="-20" y="-40" width="160" height="160" fill="#fff"/>${eyes}</mask>`
const EYES = {
  run: mask(
    "e",
    '<ellipse cx="70.5" cy="21" rx="3.6" ry="5.2"/><ellipse cx="83" cy="21" rx="3.6" ry="5.2"/>'
  ),
  ask: mask(
    "e",
    '<ellipse cx="71" cy="25.5" rx="3.3" ry="4.8"/><ellipse cx="82" cy="25.5" rx="3.3" ry="4.8"/>'
  ),
  done: mask(
    "e",
    '<path d="M65 25 q4.6 -7 9.2 0 M78 25 q4.6 -7 9.2 0" fill="none" stroke="#000" stroke-width="3.6" stroke-linecap="round"/>'
  ),
  sleep: mask(
    "e",
    '<path d="M65 23 h9 M78 23 h9" fill="none" stroke="#000" stroke-width="3.6" stroke-linecap="round"/>'
  ),
  failed: mask(
    "e",
    '<path d="M67.4 21.9 L74.6 29.1 M74.6 21.9 L67.4 29.1 M78.4 21.9 L85.6 29.1 M85.6 21.9 L78.4 29.1" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round"/>'
  ),
}
const SQUARE = '<rect x="52" y="0" width="48" height="45" rx="15"'
const TRIANGLE =
  '<path d="M76 6 L92 35 L60 35 Z" stroke-width="17" stroke-linejoin="round"'

/** Each hat, in `color`. */
const HATS = {
  rest: (color) => `<g ${TIP}>${SQUARE} fill="${color}"/></g>`,
  run: (color) =>
    `<defs>${EYES.run}</defs><g ${TIP}><circle cx="76" cy="22.5" r="23.5" mask="url(#e)" fill="${color}"/></g>`,
  ask: (color) =>
    `<defs>${EYES.ask}</defs><g ${TIP}>${TRIANGLE} mask="url(#e)" fill="${color}" stroke="${color}"/></g>`,
  failed: (color) =>
    `<defs>${EYES.failed}</defs><g ${TIP}>${TRIANGLE} mask="url(#e)" fill="${color}" stroke="${color}"/></g>`,
  done: (color) =>
    `<defs>${EYES.done}</defs><g ${TIP}>${SQUARE} mask="url(#e)" fill="${color}"/></g>`,
  sleep: (color) =>
    `<defs>${EYES.sleep}</defs><g ${TIP}>${SQUARE} mask="url(#e)" fill="${color}"/></g>` +
    `<path d="M98 -20 h12 l-12 13 h12" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
}

/** The mark in the menu bar, 16 px, as the mock's `.bi .mk`: the tiles
 * and `hat`, tiles in `tiles`. */
const mark = (hat, tiles, color = tiles) => ({
  size: [16, 16],
  box: [-5, -8, 110, 110],
  body: `<g fill="${tiles}">${TILES}</g>${HATS[hat](color)}`,
})
/** Asleep, dimmed as the mock's `.bi.dim`: 18 by 20 px at the same
 * scale, for the hat's z, about the same middle, so the mark stays where
 * it was. */
const asleep = {
  size: [18, 20],
  box: [-5, -21.75, 123.75, 137.5],
  body: `<g opacity=".5">${TILES}${HATS.sleep("#000")}</g>`,
}
/** A sign off macOS, 16 px, in the ink of a `bar` that is light or dark:
 * the mark as it is in the menu bar, the hat that asks in that scheme's
 * attention. Asleep is a square here too, so its mark is drawn a little
 * smaller, as the mock's (tray-linux-windows), and its z stays inside. */
const tray = (hat, bar) =>
  hat === "sleep"
    ? {
        size: [16, 16],
        box: [-5, -24, 126, 126],
        body: `<g opacity=".5" fill="${BAR[bar]}">${TILES}${HATS.sleep(BAR[bar])}</g>`,
      }
    : mark(hat, BAR[bar], hat === "ask" ? ATTENTION[bar] : BAR[bar])
/** A row's mark in the panel, 16 px: the hat alone, as the mock's `.am`. */
const row = (hat, color) => ({
  size: [16, 16],
  box: [48, -6, 56, 56],
  body: HATS[hat](color),
})

const ICONS = {
  // The menu bar.
  restTemplate: mark("rest", "#000"),
  workingTemplate: mark("run", "#000"),
  doneTemplate: mark("done", "#000"),
  "asking-light": mark("ask", BAR.light, ATTENTION.light),
  "asking-dark": mark("ask", BAR.dark, ATTENTION.dark),
  asleepTemplate: asleep,
  // The panel's rows.
  "row-workingTemplate": row("run", "#000"),
  "row-asking": row("ask", ATTENTION.light),
  "row-failed": row("failed", DESTRUCTIVE),
  "row-done": row("done", ADDED),
  "row-woke": row("rest", WOKE),
}

/** The signs off macOS, each by its hat. */
const TRAY = {
  rest: "rest",
  working: "run",
  asking: "ask",
  done: "done",
  asleep: "sleep",
}
/** The sizes an `.ico` holds: Windows' small icon at 100, 125, 150 and
 * 200%. The first is the `.png`, the last the `@2x.png`. */
const SIZES = [16, 20, 24, 32]

/** An `.ico` of square PNGs, each `[px, bytes]`: a header of 6 bytes, an
 * entry of 16 for each picture, then the pictures as they are. */
const ico = (pictures) => {
  const head = Buffer.alloc(6 + 16 * pictures.length)
  head.writeUInt16LE(1, 2) // An icon, not a cursor.
  head.writeUInt16LE(pictures.length, 4)
  let at = head.length
  pictures.forEach(([px, png], index) => {
    const entry = 6 + 16 * index
    head.writeUInt8(px, entry) // Its width,
    head.writeUInt8(px, entry + 1) // and its height.
    head.writeUInt16LE(1, entry + 4) // One colour plane,
    head.writeUInt16LE(32, entry + 6) // of 32 bits a pixel.
    head.writeUInt32LE(png.length, entry + 8)
    head.writeUInt32LE(at, entry + 12)
    at += png.length
  })
  return Buffer.concat([head, ...pictures.map(([, png]) => png)])
}

const scratch = mkdtempSync(join(tmpdir(), "banda-menu-bar-"))
/** `icon` as an SVG file in the scratch folder. */
const svgOf = (name, { size: [width, height], box, body }) => {
  const svg = join(scratch, `${name}.svg`)
  writeFileSync(
    svg,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${box.join(" ")}">${body}</svg>`
  )
  return svg
}
try {
  for (const [name, icon] of Object.entries(ICONS)) {
    const svg = svgOf(name, icon)
    for (const [zoom, suffix] of [
      ["1", ""],
      ["2", "@2x"],
    ])
      execFileSync("resvg", [
        "-z",
        zoom,
        svg,
        join(here, `${name}${suffix}.png`),
      ])
  }
  mkdirSync(join(here, "tray"), { recursive: true })
  for (const [sign, hat] of Object.entries(TRAY))
    for (const bar of ["light", "dark"]) {
      const name = `${sign}-${bar}`
      const svg = svgOf(`tray-${name}`, tray(hat, bar))
      const pictures = SIZES.map((px) => {
        const png = join(scratch, `${name}-${px}.png`)
        execFileSync("resvg", ["-w", String(px), svg, png])
        return [px, readFileSync(png)]
      })
      const out = join(here, "tray", name)
      writeFileSync(`${out}.png`, pictures[0][1])
      writeFileSync(`${out}@2x.png`, pictures.at(-1)[1])
      writeFileSync(`${out}.ico`, ico(pictures))
    }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
