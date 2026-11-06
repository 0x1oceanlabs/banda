import { expect, test } from "vitest"
import { charOf, hexOf, offsetDigits, offsetText, parseOffset } from "./hex"

test("a row writes its offset in hex, as wide as the file needs and eight at least", () => {
  expect(offsetDigits(0)).toBe(8)
  expect(offsetDigits(0xffff_ffff)).toBe(8)
  expect(offsetDigits(2 ** 36)).toBe(9)
  expect(offsetText(0xa0f0, 8)).toBe("0000a0f0")
})

test("a byte is two hex digits, and as text itself when it prints, else a dot", () => {
  expect([0, 10, 255].map(hexOf)).toEqual(["00", "0a", "ff"])
  expect([0x41, 0x20, 0x7e, 0x7f, 0x00, 0xe9].map(charOf).join("")).toBe(
    "A ~···"
  )
})

test("an offset is typed in decimal, or in hex with 0x or a letter", () => {
  expect(parseOffset("4096")).toBe(4096)
  expect(parseOffset(" 0x1000 ")).toBe(4096)
  expect(parseOffset("1f0a")).toBe(0x1f0a)
  expect(parseOffset("10h")).toBe(16)
  expect(parseOffset("1_000")).toBe(1000)
  expect(parseOffset("")).toBeNull()
  expect(parseOffset("zz")).toBeNull()
})
