import { expect, test } from "vitest"
import { Cache, KEEP_FOR, LIMIT, type Shelf } from "./cache"
import type { DeviceStorage } from "./queue"
import { deviceStorage as storage } from "./testing"

const isWords = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((one) => typeof one === "string")
const WORDS: Shelf<string[]> = { name: "words@1", is: isWords }

test("what a machine said is read back with when it was heard, by another window on the same storage too", () => {
  const { device } = storage()
  const cache = new Cache(
    () => device,
    () => 1_000
  )
  expect(cache.read("arc", WORDS)).toBeUndefined()
  expect(cache.write("arc", WORDS, ["a", "b"])).toBe(true)
  expect(cache.write("dev box/1", WORDS, ["c"], 500)).toBe(true)

  const again = new Cache(
    () => device,
    () => 2_000
  )
  expect(again.read("arc", WORDS)).toEqual({ value: ["a", "b"], at: 1_000 })
  expect(again.read("dev box/1", WORDS)).toEqual({ value: ["c"], at: 500 })
  expect(again.machines().sort()).toEqual(["arc", "dev box/1"])
})

test("a shelf of another version, a value that is not the shelf's, and one past its time read as none", () => {
  const { device, kept } = storage()
  let now = 0
  const cache = new Cache(
    () => device,
    () => now
  )
  cache.write("arc", WORDS, ["a"])
  expect(cache.read("arc", { ...WORDS, name: "words@2" })).toBeUndefined()
  const numbers: Shelf<number[]> = {
    name: WORDS.name,
    is: (value): value is number[] =>
      Array.isArray(value) && value.every(Number.isFinite),
  }
  expect(cache.read("arc", numbers)).toBeUndefined()
  for (const key of kept.keys()) kept.set(key, "{not json")
  expect(cache.read("arc", WORDS)).toBeUndefined()

  cache.write("arc", WORDS, ["a"])
  now = KEEP_FOR
  expect(cache.read("arc", WORDS)).toEqual({ value: ["a"], at: 0 })
  now = KEEP_FOR + 1
  expect(cache.read("arc", WORDS)).toBeUndefined()
})

test("wiping a machine forgets every shelf of it, and nothing of another machine or of anyone else's in the storage", () => {
  const { device, kept } = storage(new Map([["banda.waiting.x", "kept"]]))
  const cache = new Cache(() => device)
  cache.write("arc", WORDS, ["a"])
  cache.write("arc", { ...WORDS, name: "words@2" }, ["b"])
  // A machine whose key starts as another's is its own.
  cache.write("arc2", WORDS, ["c"])
  cache.wipe("arc")
  expect(cache.read("arc", WORDS)).toBeUndefined()
  expect(cache.machines()).toEqual(["arc2"])
  expect(cache.read("arc2", WORDS)?.value).toEqual(["c"])
  expect(kept.get("banda.waiting.x")).toBe("kept")
})

test("a value over the limit, or one the storage does not take, is not kept, and what was kept before it goes", () => {
  const { device } = storage()
  const cache = new Cache(() => device)
  cache.write("arc", WORDS, ["a"])
  expect(cache.write("arc", WORDS, ["x".repeat(LIMIT)])).toBe(false)
  expect(cache.read("arc", WORDS)).toBeUndefined()

  cache.write("arc", WORDS, ["a"])
  const full: DeviceStorage = {
    ...device,
    setItem: () => {
      throw new Error("QuotaExceededError")
    },
  }
  expect(new Cache(() => full).write("arc", WORDS, ["b"])).toBe(false)
  expect(cache.read("arc", WORDS)).toBeUndefined()
})

test("a storage that fails keeps nothing and reads as empty", () => {
  const cache = new Cache(() => {
    throw new Error("no storage here")
  })
  expect(cache.write("arc", WORDS, ["a"])).toBe(false)
  expect(cache.read("arc", WORDS)).toBeUndefined()
  expect(cache.machines()).toEqual([])
  expect(() => cache.wipe("arc")).not.toThrow()
})
