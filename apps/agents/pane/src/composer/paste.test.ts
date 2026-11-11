import { expect, test } from "vitest"
import { long, pastedFile } from "./paste"

test("a text of 32 KiB or more is long, counted in bytes", () => {
  expect(long("a".repeat(32 * 1024 - 1))).toBe(false)
  expect(long("a".repeat(32 * 1024))).toBe(true)
  // Three bytes each.
  expect(long("я".repeat(11 * 1024))).toBe(false)
  expect(long("€".repeat(11 * 1024))).toBe(true)
})

test("each long text kept is named after those the message names", () => {
  expect(pastedFile("x", "").name).toBe("pasted-text-1.txt")
  expect(
    pastedFile("x", "see @pasted-text-1.txt and @pasted-text-2.txt").name
  ).toBe("pasted-text-3.txt")
  expect(pastedFile("x", "").type).toBe("text/plain")
})
