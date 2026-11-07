/**
 * What a font file says of itself (ADR 0073, decision 6): its family, its
 * style and its full name from its `name` table, how many glyphs it has,
 * and the characters it draws from its `cmap`. It reads TrueType and
 * OpenType, a collection's first font, WOFF, and WOFF2 where the page
 * can unpack Brotli. Pure but for unpacking, which is given.
 */

/** What a font says of itself. */
export type FontFacts = {
  family: string | null
  style: string | null
  full: string | null
  version: string | null
  /** How many glyphs it holds. */
  glyphs: number | null
  /** The characters it draws, as code points, in order: the first
   * `MOST_CHARS`. */
  chars: number[]
  /** How many characters it draws in all. */
  charCount: number
}

/** The most characters listed. */
export const MOST_CHARS = 4096

/** Unpacks bytes packed as zlib (`deflate`) or Brotli (`brotli`); null
 * when it cannot. */
export type Inflate = (
  bytes: Uint8Array,
  format: "deflate" | "brotli"
) => Promise<Uint8Array | null>

/** Unpacks with the page's own streams. */
export const inflate: Inflate = async (bytes, format) => {
  try {
    const stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream(format as CompressionFormat))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

const tag = (view: DataView, at: number) =>
  String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3)
  )

/** The tables Files reads. */
const WANTED = ["name", "cmap", "maxp"]

type Tables = Map<string, Uint8Array>

/** An sfnt's tables, from the font that starts at `start`. */
function sfntTables(bytes: Uint8Array, start = 0): Tables {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables: Tables = new Map()
  const count = view.getUint16(start + 4)
  for (let n = 0; n < count; n++) {
    const at = start + 12 + n * 16
    const name = tag(view, at)
    if (!WANTED.includes(name)) continue
    const offset = view.getUint32(at + 8)
    const length = view.getUint32(at + 12)
    tables.set(name, bytes.subarray(offset, offset + length))
  }
  return tables
}

async function woffTables(bytes: Uint8Array, unpack: Inflate): Promise<Tables> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables: Tables = new Map()
  const count = view.getUint16(12)
  for (let n = 0; n < count; n++) {
    const at = 44 + n * 20
    const name = tag(view, at)
    if (!WANTED.includes(name)) continue
    const offset = view.getUint32(at + 4)
    const packed = view.getUint32(at + 8)
    const length = view.getUint32(at + 12)
    const raw = bytes.subarray(offset, offset + packed)
    const table = packed < length ? await unpack(raw, "deflate") : raw
    if (table) tables.set(name, table)
  }
  return tables
}

/** WOFF2's known tables, by their index in its directory. */
const WOFF2_TAGS = [
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
  "gvar",
  "hsty",
  "just",
  "lcar",
  "mort",
  "morx",
  "opbd",
  "prop",
  "trak",
  "Zapf",
  "Silf",
  "Glat",
  "Gloc",
  "Feat",
  "Sill",
]

async function woff2Tables(
  bytes: Uint8Array,
  unpack: Inflate
): Promise<Tables> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint16(12)
  const packed = view.getUint32(20)
  let at = 48
  // A UIntBase128: seven bits a byte, the high bit saying more come.
  const base128 = () => {
    let value = 0
    for (let n = 0; n < 5; n++) {
      const byte = view.getUint8(at++)
      value = value * 128 + (byte & 0x7f)
      if (!(byte & 0x80)) return value
    }
    throw new Error("A WOFF2 length runs too long.")
  }
  const directory: { name: string; length: number }[] = []
  for (let n = 0; n < count; n++) {
    const flags = view.getUint8(at++)
    const index = flags & 0x3f
    const name =
      index === 63 ? tag(view, (at += 4) - 4) : (WOFF2_TAGS[index] ?? "")
    const transform = flags >> 6
    const original = base128()
    // glyf and loca are transformed unless their version is 3; the rest
    // are unless it is 0.
    const glyphs = name === "glyf" || name === "loca"
    const transformed = glyphs ? transform !== 3 : transform !== 0
    directory.push({ name, length: transformed ? base128() : original })
  }
  // A collection's directory follows; only its first font is read, and
  // its tables are the first of the stream all the same.
  if (tag(view, 4) === "ttcf")
    throw new Error("A WOFF2 collection is not read.")
  const stream = await unpack(bytes.subarray(at, at + packed), "brotli")
  const tables: Tables = new Map()
  if (!stream) return tables
  let offset = 0
  for (const { name, length } of directory) {
    if (WANTED.includes(name))
      tables.set(name, stream.subarray(offset, offset + length))
    offset += length
  }
  return tables
}

/** A font's tables Files reads, from its bytes. */
async function tablesOf(bytes: Uint8Array, unpack: Inflate): Promise<Tables> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  switch (tag(view, 0)) {
    case "wOFF":
      return woffTables(bytes, unpack)
    case "wOF2":
      return woff2Tables(bytes, unpack)
    case "ttcf":
      return sfntTables(bytes, view.getUint32(12))
    default:
      return sfntTables(bytes)
  }
}

/** The names a `name` table holds, by their ID: Windows's in English
 * first, then any Windows's, then Unicode's, then a Mac's. */
export function namesOf(table: Uint8Array): Map<number, string> {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength)
  const count = view.getUint16(2)
  const strings = view.getUint16(4)
  const rank = (platform: number, language: number) =>
    platform === 3 ? (language === 0x409 ? 0 : 1) : platform === 0 ? 2 : 3
  const best = new Map<number, { rank: number; text: string }>()
  for (let n = 0; n < count; n++) {
    const at = 6 + n * 12
    const platform = view.getUint16(at)
    const encoding = view.getUint16(at + 2)
    const language = view.getUint16(at + 4)
    const id = view.getUint16(at + 6)
    const length = view.getUint16(at + 8)
    const offset = strings + view.getUint16(at + 10)
    if (platform === 1 && encoding !== 0) continue
    if (platform !== 0 && platform !== 1 && platform !== 3) continue
    const ranked = rank(platform, language)
    if ((best.get(id)?.rank ?? Infinity) <= ranked) continue
    const raw = table.subarray(offset, offset + length)
    const text =
      platform === 1
        ? String.fromCharCode(...raw)
        : new TextDecoder("utf-16be").decode(raw)
    best.set(id, { rank: ranked, text })
  }
  return new Map([...best].map(([id, { text }]) => [id, text]))
}

/** The characters a `cmap` table draws, in order: from its Unicode
 * table of format 12, else of format 4. */
export function charsOf(table: Uint8Array): number[] {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength)
  const count = view.getUint16(2)
  const subtables: {
    platform: number
    encoding: number
    format: number
    at: number
  }[] = []
  for (let n = 0; n < count; n++) {
    const platform = view.getUint16(4 + n * 8)
    const encoding = view.getUint16(6 + n * 8)
    const at = view.getUint32(8 + n * 8)
    const unicode =
      platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    if (unicode)
      subtables.push({ platform, encoding, format: view.getUint16(at), at })
  }
  const wide = subtables.find((one) => one.format === 12)
  if (wide) return format12(view, wide.at)
  const basic = subtables.find((one) => one.format === 4)
  return basic ? format4(view, basic.at) : []
}

function format12(view: DataView, at: number): number[] {
  const chars: number[] = []
  const groups = view.getUint32(at + 12)
  for (let n = 0; n < groups; n++) {
    const first = view.getUint32(at + 16 + n * 12)
    const last = view.getUint32(at + 20 + n * 12)
    for (let char = first; char <= last && chars.length < 0x110000; char++)
      chars.push(char)
  }
  return chars
}

function format4(view: DataView, at: number): number[] {
  const chars: number[] = []
  const segments = view.getUint16(at + 6) / 2
  const ends = at + 14
  const starts = ends + segments * 2 + 2
  const deltas = starts + segments * 2
  const ranges = deltas + segments * 2
  for (let n = 0; n < segments; n++) {
    const first = view.getUint16(starts + n * 2)
    const last = view.getUint16(ends + n * 2)
    const delta = view.getInt16(deltas + n * 2)
    const range = view.getUint16(ranges + n * 2)
    for (let char = first; char <= last && char !== 0xffff; char++) {
      let glyph: number
      if (range === 0) glyph = (char + delta) & 0xffff
      else {
        const where = ranges + n * 2 + range + (char - first) * 2
        glyph = where + 2 <= view.byteLength ? view.getUint16(where) : 0
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff
      }
      if (glyph !== 0) chars.push(char)
    }
  }
  return chars
}

/** What the font in `bytes` says of itself; empty facts for one it
 * cannot read. */
export async function factsOf(
  bytes: Uint8Array,
  unpack: Inflate = inflate
): Promise<FontFacts> {
  const facts: FontFacts = {
    family: null,
    style: null,
    full: null,
    version: null,
    glyphs: null,
    chars: [],
    charCount: 0,
  }
  try {
    const tables = await tablesOf(bytes, unpack)
    const name = tables.get("name")
    if (name) {
      const names = namesOf(name)
      // The typographic family and style, where a family has many.
      facts.family = names.get(16) ?? names.get(1) ?? null
      facts.style = names.get(17) ?? names.get(2) ?? null
      facts.full = names.get(4) ?? null
      facts.version = names.get(5) ?? null
    }
    const maxp = tables.get("maxp")
    if (maxp && maxp.byteLength >= 6)
      facts.glyphs = new DataView(maxp.buffer, maxp.byteOffset).getUint16(4)
    const cmap = tables.get("cmap")
    if (cmap) {
      const chars = charsOf(cmap)
      facts.charCount = chars.length
      facts.chars = chars.slice(0, MOST_CHARS)
    }
  } catch {
    // A font cut short or of a shape not read: what was read stays.
  }
  return facts
}
