import { expect, test } from "vitest"
import { CHIMES, FAMILIES, LEVELS, RECIPES } from "./families"
import { DEFAULT_SOUND, voicing } from "./settings"

test("every family plays every call, at a measured level", () => {
  for (const family of FAMILIES)
    for (const chime of CHIMES) {
      expect(RECIPES[family][chime]).toBeTypeOf("function")
      expect(LEVELS[family][chime]).toBeTypeOf("number")
    }
})

test("a call sounds in its family, at the volume, unless silenced", () => {
  const done = voicing("done", DEFAULT_SOUND)
  expect(done?.family).toBe("banda")
  expect(done?.gain).toBeCloseTo(0.6 * Math.pow(10, -0.3 / 20))
  expect(voicing("asking", { ...DEFAULT_SOUND, family: "off" })).toBe(undefined)
  expect(voicing("failed", { ...DEFAULT_SOUND, failed: false })).toBe(undefined)
  expect(voicing("done", { ...DEFAULT_SOUND, volume: 0 })).toBe(undefined)
})

test("one call can borrow another family's sound", () => {
  const settings = { ...DEFAULT_SOUND, asking: "wood" as const }
  expect(voicing("asking", settings)?.family).toBe("wood")
  expect(voicing("done", settings)?.family).toBe("banda")
})

test("the volume stays between 0 and 1", () => {
  const loud = voicing("done", { ...DEFAULT_SOUND, volume: 4 })
  expect(loud?.gain).toBeCloseTo(Math.pow(10, -0.3 / 20))
})
