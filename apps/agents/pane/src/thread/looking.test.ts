import { describe, expect, test } from "vitest"
import { actsHere } from "./looking"

describe("actsHere", () => {
  test("a click or a plain key is the Person working in the Thread", () => {
    expect(actsHere({ type: "pointerdown" })).toBe(true)
    expect(actsHere({ type: "keydown", key: "a" })).toBe(true)
    expect(actsHere({ type: "keydown", key: "Enter", shiftKey: true })).toBe(
      true
    )
  })

  test("a key with the mod is the window's, moving on", () => {
    expect(actsHere({ type: "keydown", key: "ArrowRight", altKey: true })).toBe(
      false
    )
    expect(actsHere({ type: "keydown", key: "c", ctrlKey: true })).toBe(false)
    expect(actsHere({ type: "keydown", key: "k", metaKey: true })).toBe(false)
  })

  test("a wheel is no act: the Strip scrolls by with it", () => {
    expect(actsHere({ type: "wheel" })).toBe(false)
  })
})
