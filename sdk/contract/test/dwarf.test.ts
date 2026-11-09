import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, test } from "vitest"
import { compileUnits } from "./dwarf"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "banda-dwarf-"))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

type Section = { name: string; data: Buffer; flags?: bigint }

/** A 64-bit little-endian ELF of `sections`, and its names' table. */
function elf(sections: Section[]): Buffer {
  const all = [{ name: "", data: Buffer.alloc(0) }, ...sections]
  const names: number[] = []
  let text = ""
  for (const { name } of [...all, { name: ".shstrtab" }]) {
    names.push(Buffer.byteLength(text))
    text += `${name}\0`
  }
  const bodies = [...all, { name: ".shstrtab", data: Buffer.from(text) }]
  const offsets: number[] = []
  let at = 64
  for (const { data } of bodies) {
    offsets.push(at)
    at += data.length
  }
  const header = Buffer.alloc(64)
  header.writeUInt32BE(0x7f454c46, 0)
  header[4] = 2
  header[5] = 1
  header.writeBigUInt64LE(BigInt(at), 0x28)
  header.writeUInt16LE(64, 0x3a)
  header.writeUInt16LE(bodies.length, 0x3c)
  header.writeUInt16LE(bodies.length - 1, 0x3e)
  const table = Buffer.alloc(64 * bodies.length)
  bodies.forEach((body, index) => {
    table.writeUInt32LE(names[index]!, index * 64)
    table.writeBigUInt64LE(
      "flags" in body ? (body.flags ?? 0n) : 0n,
      index * 64 + 8
    )
    table.writeBigUInt64LE(BigInt(offsets[index]!), index * 64 + 24)
    table.writeBigUInt64LE(BigInt(body.data.length), index * 64 + 32)
  })
  return Buffer.concat([header, ...bodies.map(({ data }) => data), table])
}

const u8 = (value: number) => Buffer.from([value])
const u16 = (value: number) => {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value)
  return buffer
}
const u32 = (value: number) => {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value)
  return buffer
}

/** A unit: its length, then `body`. */
const unit = (body: Buffer) => Buffer.concat([u32(body.length), body])

/** One abbreviation, code 1, a unit with no children and `attributes`. */
const abbreviation = (tag: number, attributes: [number, number][]) =>
  Buffer.from([1, tag, 0, ...attributes.flat(), 0, 0, 0])

/** Strings laid end to end, and where each starts. */
function strings(...each: string[]): { data: Buffer; at: number[] } {
  const at: number[] = []
  let text = ""
  for (const one of each) {
    at.push(Buffer.byteLength(text))
    text += `${one}\0`
  }
  return { data: Buffer.from(text), at }
}

const RUST = "kernel/src/lib.rs/@/banda_kernel.1a2b-cgu.0"
const CHECKOUT = "/home/someone/banda"

/** As rustc writes a unit: DWARF 4, its strings in .debug_str. */
function rustc(): Section[] {
  const str = strings("clang LLVM (rustc)", RUST, CHECKOUT)
  const abbrev = abbreviation(0x11, [
    [0x25, 0x0e], // producer, strp
    [0x13, 0x05], // language, data2
    [0x03, 0x0e], // name, strp
    [0x10, 0x17], // stmt_list, sec_offset
    [0x1b, 0x0e], // comp_dir, strp
    [0x11, 0x01], // low_pc, addr
    [0x12, 0x06], // high_pc, data4
  ])
  const info = unit(
    Buffer.concat([
      u16(4),
      u32(0), // its abbreviations
      u8(8), // address size
      u8(1),
      u32(str.at[0]!),
      u16(0x1c),
      u32(str.at[1]!),
      u32(0),
      u32(str.at[2]!),
      Buffer.alloc(8),
      u32(16),
    ])
  )
  return [
    { name: ".debug_info", data: info },
    { name: ".debug_abbrev", data: abbrev },
    { name: ".debug_str", data: str.data },
  ]
}

function write(data: Buffer): string {
  const path = join(dir, "banda")
  writeFileSync(path, data)
  return path
}

test("a unit's name and the folder it was compiled in are read", () => {
  expect(compileUnits(write(elf(rustc())))).toEqual([
    { name: RUST, dir: CHECKOUT },
  ])
})

test("DWARF 5's string forms are read, and a unit with a form it does not know is left out", () => {
  const str = strings("std/src/lib.rs/@/std.cgu.0")
  const lineStr = strings("/rustc/1")
  // .debug_str_offsets: its header, then the offsets; the base is past it.
  const offsets = Buffer.concat([u32(8), u16(5), u16(0), u32(str.at[0]!)])
  const five = abbreviation(0x11, [
    [0x03, 0x25], // name, strx1
    [0x1b, 0x1f], // comp_dir, line_strp
    [0x72, 0x17], // str_offsets_base, sec_offset
  ])
  const unknown = abbreviation(0x11, [[0x03, 0x7f]])
  const fiveUnit = (abbrev: number, body: Buffer) =>
    unit(Buffer.concat([u16(5), u8(1), u8(8), u32(abbrev), u8(1), body]))
  const info = Buffer.concat([
    fiveUnit(five.length, Buffer.from([0x7f, 0x7f])),
    fiveUnit(0, Buffer.concat([u8(0), u32(lineStr.at[0]!), u32(8)])),
  ])
  const sections = [
    { name: ".debug_info", data: info },
    { name: ".debug_abbrev", data: Buffer.concat([five, unknown]) },
    { name: ".debug_str", data: str.data },
    { name: ".debug_line_str", data: lineStr.data },
    { name: ".debug_str_offsets", data: offsets },
  ]
  expect(compileUnits(write(elf(sections)))).toEqual([
    { name: "std/src/lib.rs/@/std.cgu.0", dir: "/rustc/1" },
  ])
})

test("a program with no DWARF to read has none", () => {
  expect(compileUnits(write(Buffer.from("#!/bin/sh\n")))).toBeNull()
  expect(compileUnits(join(dir, "nothing"))).toBeNull()
  expect(compileUnits(write(elf([])))).toBeNull()
  const compressed = rustc().map((section) =>
    section.name === ".debug_info" ? { ...section, flags: 0x800n } : section
  )
  expect(compileUnits(write(elf(compressed)))).toBeNull()
})
