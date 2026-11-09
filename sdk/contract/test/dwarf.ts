/**
 * Where each crate in a program was compiled, from the DWARF an ELF program
 * carries. rustc names a compile unit after its crate's root file, relative
 * to the folder it ran in for a crate of the workspace
 * (`kernel/src/lib.rs/@/…`), and keeps that folder as the unit's
 * DW_AT_comp_dir. With one target/ shared between checkouts, it is what
 * says which checkout each crate in target/debug/banda came from.
 */
import { closeSync, openSync, readSync } from "node:fs"

/** A compile unit: its name, and the folder it was compiled in. */
export type Unit = { name: string; dir: string }

/**
 * The program's compile units, or null where there are none to read: not a
 * 64-bit little-endian ELF (a Mac's and Windows' programs keep their DWARF
 * apart), built with no debug information, as CI builds, or with it
 * compressed. A unit whose header this does not read is left out.
 */
export function compileUnits(path: string): Unit[] | null {
  let fd: number | undefined
  try {
    fd = openSync(path, "r")
    const found = sections(fd)
    const info = found?.get(".debug_info")
    const abbrev = found?.get(".debug_abbrev")
    if (!found || !info || !abbrev) return null
    for (const section of found.values())
      if (section.flags & COMPRESSED && section.name.startsWith(".debug_"))
        return null
    const data = (name: string) => {
      const section = found.get(name)
      return section ? read(fd!, section.offset, section.size) : undefined
    }
    return units({
      info: read(fd, info.offset, info.size),
      abbrev: read(fd, abbrev.offset, abbrev.size),
      str: data(".debug_str"),
      lineStr: data(".debug_line_str"),
      strOffsets: data(".debug_str_offsets"),
    })
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

const COMPRESSED = 0x800n

type Section = { name: string; flags: bigint; offset: number; size: number }

function read(fd: number, offset: number, length: number): Buffer {
  const buffer = Buffer.alloc(length)
  let at = 0
  while (at < length) {
    const got = readSync(fd, buffer, at, length - at, offset + at)
    if (got === 0) throw new RangeError("the file ends early")
    at += got
  }
  return buffer
}

/** The ELF's sections by name, or null for another kind of file. */
function sections(fd: number): Map<string, Section> | null {
  const header = read(fd, 0, 64)
  // \x7fELF, 64-bit, little-endian.
  if (header.readUInt32BE(0) !== 0x7f454c46 || header[4] !== 2) return null
  if (header[5] !== 1) return null
  const start = Number(header.readBigUInt64LE(0x28))
  const size = header.readUInt16LE(0x3a)
  let count = header.readUInt16LE(0x3c)
  let names = header.readUInt16LE(0x3e)
  if (start === 0) return null
  // Past 0xff00 sections, the first section header holds the numbers.
  if (count === 0 || names === 0xffff) {
    const first = read(fd, start, size)
    if (count === 0) count = Number(first.readBigUInt64LE(32))
    if (names === 0xffff) names = first.readUInt32LE(40)
  }
  const table = read(fd, start, count * size)
  const at = (index: number) => ({
    name: table.readUInt32LE(index * size),
    flags: table.readBigUInt64LE(index * size + 8),
    offset: Number(table.readBigUInt64LE(index * size + 24)),
    size: Number(table.readBigUInt64LE(index * size + 32)),
  })
  const strings = at(names)
  const text = read(fd, strings.offset, strings.size)
  const found = new Map<string, Section>()
  for (let index = 0; index < count; index++) {
    const section = at(index)
    const name = text.toString(
      "latin1",
      section.name,
      text.indexOf(0, section.name)
    )
    found.set(name, { ...section, name })
  }
  return found
}

class Cursor {
  readonly data: Buffer
  at: number
  constructor(data: Buffer, at: number) {
    this.data = data
    this.at = at
  }
  u8(): number {
    if (this.at >= this.data.length) throw new RangeError("past the end")
    return this.data[this.at++]!
  }
  u16(): number {
    const value = this.data.readUInt16LE(this.at)
    this.at += 2
    return value
  }
  u32(): number {
    const value = this.data.readUInt32LE(this.at)
    this.at += 4
    return value
  }
  u64(): number {
    const value = Number(this.data.readBigUInt64LE(this.at))
    this.at += 8
    return value
  }
  /** A number of `bytes` bytes, little-endian. */
  sized(bytes: number): number {
    let value = 0
    for (let byte = 0; byte < bytes; byte++)
      value += this.u8() * 2 ** (8 * byte)
    return value
  }
  /** An unsigned LEB128; a signed one is skipped the same way. */
  leb(): number {
    let value = 0
    let shift = 0
    let byte: number
    do {
      byte = this.u8()
      value += (byte & 0x7f) * 2 ** shift
      shift += 7
    } while (byte & 0x80)
    return value
  }
  skip(bytes: number): void {
    if (this.at + bytes > this.data.length) throw new RangeError("past the end")
    this.at += bytes
  }
  string(): string {
    const end = this.data.indexOf(0, this.at)
    if (end < 0) throw new RangeError("no end to the string")
    const value = this.data.toString("utf8", this.at, end)
    this.at = end + 1
    return value
  }
}

type Data = {
  info: Buffer
  abbrev: Buffer
  str?: Buffer
  lineStr?: Buffer
  strOffsets?: Buffer
}

/** A string attribute's value, or where to find it. */
type Text =
  | { string: string }
  | { offset: number; in: "str" | "lineStr" }
  | { index: number }

const AT_NAME = 0x03
const AT_COMP_DIR = 0x1b
const AT_STR_OFFSETS_BASE = 0x72
const UNIT_TAGS = new Set([0x11, 0x3c, 0x4a]) // compile, partial, skeleton

function units(data: Data): Unit[] {
  const found: Unit[] = []
  let next = 0
  while (next + 4 <= data.info.length) {
    const unit = new Cursor(data.info, next)
    let length = unit.u32()
    let offsetSize = 4
    if (length === 0xffffffff) {
      length = unit.u64()
      offsetSize = 8
    }
    const start = unit.at
    next = start + length
    try {
      const read = header(unit, offsetSize)
      if (read) {
        const named = attributes(unit, data.abbrev, read)
        const name = text(named.name, data, named.base, offsetSize)
        const dir = text(named.dir, data, named.base, offsetSize)
        if (name !== undefined && dir !== undefined) found.push({ name, dir })
      }
    } catch {
      // A form or a header this does not know: the next unit's length
      // still says where it starts.
    }
  }
  return found
}

type Header = {
  version: number
  addressSize: number
  offsetSize: number
  abbrev: number
}

function header(unit: Cursor, offsetSize: number): Header | null {
  const version = unit.u16()
  if (version < 2 || version > 5) return null
  if (version < 5) {
    const abbrev = unit.sized(offsetSize)
    return { version, abbrev, addressSize: unit.u8(), offsetSize }
  }
  const type = unit.u8()
  const addressSize = unit.u8()
  const abbrev = unit.sized(offsetSize)
  // A skeleton unit has its split unit's id; type and split units hold no
  // compile unit of their own.
  if (type === 0x04) unit.skip(8)
  else if (type !== 0x01 && type !== 0x03) return null
  return { version, abbrev, addressSize, offsetSize }
}

/** The unit's first entry, if it is the unit's own: its name, folder and
 * string offsets' base. */
function attributes(
  unit: Cursor,
  abbrevs: Buffer,
  header: Header
): { name?: Text; dir?: Text; base?: number } {
  const code = unit.leb()
  const entry = abbreviation(abbrevs, header.abbrev, code)
  if (!entry || !UNIT_TAGS.has(entry.tag)) return {}
  const named: { name?: Text; dir?: Text; base?: number } = {}
  for (const [attribute, form] of entry.attributes) {
    const value = valueOf(unit, form, header)
    if (attribute === AT_NAME) named.name = value as Text
    else if (attribute === AT_COMP_DIR) named.dir = value as Text
    else if (attribute === AT_STR_OFFSETS_BASE && typeof value === "number")
      named.base = value
  }
  return named
}

type Abbreviation = { tag: number; attributes: [number, number][] }

function abbreviation(
  data: Buffer,
  offset: number,
  code: number
): Abbreviation | undefined {
  const table = new Cursor(data, offset)
  for (;;) {
    const at = table.leb()
    if (at === 0) return undefined
    const tag = table.leb()
    table.u8() // has children
    const attributes: [number, number][] = []
    for (;;) {
      const attribute = table.leb()
      const form = table.leb()
      if (attribute === 0 && form === 0) break
      if (form === 0x21) table.leb() // implicit_const: its value is here
      attributes.push([attribute, form])
    }
    if (at === code) return { tag, attributes }
  }
}

/** Reads one attribute's value: a string's, a section offset, or nothing
 * for what this never needs. Throws on a form it does not know. */
function valueOf(
  c: Cursor,
  form: number,
  h: Header
): Text | number | undefined {
  switch (form) {
    case 0x08: // string
      return { string: c.string() }
    case 0x0e: // strp
      return { offset: c.sized(h.offsetSize), in: "str" }
    case 0x1f: // line_strp
      return { offset: c.sized(h.offsetSize), in: "lineStr" }
    case 0x1a: // strx
      return { index: c.leb() }
    case 0x25: // strx1..4
    case 0x26:
    case 0x27:
    case 0x28:
      return { index: c.sized(form - 0x24) }
    case 0x17: // sec_offset
      return c.sized(h.offsetSize)
    case 0x0b: // data1, flag, ref1
    case 0x0c:
    case 0x11:
      c.skip(1)
      return
    case 0x05: // data2, ref2
    case 0x12:
      c.skip(2)
      return
    case 0x06: // data4, ref4, ref_sup4
    case 0x13:
    case 0x1c:
      c.skip(4)
      return
    case 0x07: // data8, ref8, ref_sig8, ref_sup8
    case 0x14:
    case 0x20:
    case 0x24:
      c.skip(8)
      return
    case 0x1e: // data16
      c.skip(16)
      return
    case 0x01: // addr
      c.skip(h.addressSize)
      return
    case 0x10: // ref_addr
      c.skip(h.version === 2 ? h.addressSize : h.offsetSize)
      return
    case 0x1d: // strp_sup, GNU_ref_alt, GNU_strp_alt
    case 0x1f20:
    case 0x1f21:
      c.skip(h.offsetSize)
      return
    case 0x0d: // sdata, udata, ref_udata, addrx, loclistx, rnglistx
    case 0x0f:
    case 0x15:
    case 0x1b:
    case 0x22:
    case 0x23:
    case 0x1f01: // GNU_addr_index, GNU_str_index
    case 0x1f02:
      c.leb()
      return
    case 0x29: // addrx1..4
    case 0x2a:
    case 0x2b:
    case 0x2c:
      c.skip(form - 0x28)
      return
    case 0x19: // flag_present, implicit_const
    case 0x21:
      return
    case 0x0a: // block1
      c.skip(c.u8())
      return
    case 0x03: // block2
      c.skip(c.u16())
      return
    case 0x04: // block4
      c.skip(c.u32())
      return
    case 0x09: // block, exprloc
    case 0x18:
      c.skip(c.leb())
      return
    case 0x16: // indirect: the form comes first
      return valueOf(c, c.leb(), h)
    default:
      throw new Error(`DW_FORM ${form.toString(16)}`)
  }
}

function text(
  value: Text | undefined,
  data: Data,
  base: number | undefined,
  offsetSize: number
): string | undefined {
  if (!value) return undefined
  if ("string" in value) return value.string
  if ("in" in value) return stringAt(data[value.in], value.offset)
  if (!data.strOffsets || base === undefined) return undefined
  const at = new Cursor(data.strOffsets, base + value.index * offsetSize)
  return stringAt(data.str, at.sized(offsetSize))
}

function stringAt(
  section: Buffer | undefined,
  offset: number
): string | undefined {
  if (!section || offset >= section.length) return undefined
  const end = section.indexOf(0, offset)
  return section.toString("utf8", offset, end < 0 ? section.length : end)
}
