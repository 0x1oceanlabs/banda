import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { brotliCompressSync, deflateSync } from "node:zlib"
import { expect, test } from "vitest"
import { factsOf, MOST_CHARS } from "./font"

/** A font of pdf.js's own, so no test carries one. */
const ttf = new Uint8Array(
  readFileSync(
    createRequire(import.meta.url).resolve(
      "pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"
    )
  )
)

/** `ttf`'s tables, as its directory lists them. */
function tables(font: Uint8Array) {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
  return Array.from({ length: view.getUint16(4) }, (_, n) => {
    const at = 12 + n * 16
    const offset = view.getUint32(at + 8)
    return {
      tag: String.fromCharCode(...font.subarray(at, at + 4)),
      data: font.subarray(offset, offset + view.getUint32(at + 12)),
    }
  })
}

/** `font` as WOFF, each table packed with zlib where that is smaller. */
function woffOf(font: Uint8Array): Uint8Array {
  const all = tables(font).map((one) => {
    const packed = new Uint8Array(deflateSync(one.data))
    return {
      ...one,
      packed: packed.length < one.data.length ? packed : one.data,
    }
  })
  const head = 44 + all.length * 20
  const size = all.reduce((sum, one) => sum + one.packed.length, head)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  out.set(new TextEncoder().encode("wOFF"))
  view.setUint16(12, all.length)
  let offset = head
  all.forEach((one, n) => {
    const at = 44 + n * 20
    out.set(new TextEncoder().encode(one.tag), at)
    view.setUint32(at + 4, offset)
    view.setUint32(at + 8, one.packed.length)
    view.setUint32(at + 12, one.data.length)
    out.set(one.packed, offset)
    offset += one.packed.length
  })
  return out
}

/** `font` as WOFF2 with no table transformed, its tags written out. */
function woff2Of(font: Uint8Array): Uint8Array {
  const all = tables(font)
  const base128 = (value: number) => {
    const bytes = [value & 0x7f]
    for (
      value = Math.floor(value / 128);
      value > 0;
      value = Math.floor(value / 128)
    )
      bytes.unshift((value & 0x7f) | 0x80)
    return bytes
  }
  const directory = all.flatMap((one) => [
    // An explicit tag, and the null transform: 3 for glyf and loca.
    63 | ((one.tag === "glyf" || one.tag === "loca" ? 3 : 0) << 6),
    ...new TextEncoder().encode(one.tag),
    ...base128(one.data.length),
  ])
  const stream = new Uint8Array(
    all.reduce((sum, one) => sum + one.data.length, 0)
  )
  let at = 0
  for (const one of all) {
    stream.set(one.data, at)
    at += one.data.length
  }
  const packed = new Uint8Array(brotliCompressSync(stream))
  const out = new Uint8Array(48 + directory.length + packed.length)
  const view = new DataView(out.buffer)
  out.set(new TextEncoder().encode("wOF2"))
  view.setUint16(12, all.length)
  view.setUint32(20, packed.length)
  out.set(directory, 48)
  out.set(packed, 48 + directory.length)
  return out
}

test("a TrueType font says its family, style, glyphs and the characters it draws", async () => {
  const facts = await factsOf(ttf)
  expect(facts.family).toBe("Liberation Sans")
  expect(facts.style).toBe("Regular")
  expect(facts.full).toBe("Liberation Sans")
  expect(facts.version).toMatch(/^Version /)
  expect(facts.glyphs).toBeGreaterThan(600)
  expect(facts.chars).toContain("A".codePointAt(0))
  expect(facts.chars).toContain("Ж".codePointAt(0))
  expect(facts.chars).not.toContain(0x4e00)
  expect(facts.charCount).toBe(facts.chars.length)
  expect(facts.chars.length).toBeLessThanOrEqual(MOST_CHARS)
})

test("a WOFF and a WOFF2 say the same as the font they pack", async () => {
  const facts = await factsOf(ttf)
  expect(await factsOf(woffOf(ttf))).toEqual(facts)
  expect(await factsOf(woff2Of(ttf))).toEqual(facts)
  // Where Brotli cannot be unpacked, a WOFF2 says nothing, and breaks
  // nothing.
  const none = await factsOf(woff2Of(ttf), () => Promise.resolve(null))
  expect(none.family).toBeNull()
})

test("bytes that are no font say nothing", async () => {
  const facts = await factsOf(new TextEncoder().encode("not a font at all"))
  expect(facts).toMatchObject({ family: null, glyphs: null, chars: [] })
})
