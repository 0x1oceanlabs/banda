import { expect, test, vi } from "vitest"
import { sameEach, Store } from "./store"

test("a store tells its listeners of a new value, and of none it already holds", () => {
  const store = new Store({ n: 1 })
  const heard = vi.fn()
  const stop = store.subscribe(heard)
  const first = store.get()
  store.set(first)
  expect(heard).not.toHaveBeenCalled()
  store.set({ n: 1 })
  expect(heard).toHaveBeenCalledTimes(1)
  expect(store.get()).not.toBe(first)
  stop()
  store.set({ n: 2 })
  expect(heard).toHaveBeenCalledTimes(1)
  expect(store.get()).toEqual({ n: 2 })
})

test("a listener that stops as it hears leaves the others to hear", () => {
  const store = new Store(0)
  const heard: string[] = []
  const stop = store.subscribe(() => {
    heard.push("a")
    stop()
  })
  store.subscribe(() => heard.push("b"))
  store.set(1)
  store.set(2)
  expect(heard).toEqual(["a", "b", "b"])
})

test("two lists are the same when each holds the same objects in order", () => {
  const a = { id: "a" }
  const b = { id: "b" }
  expect(sameEach([a, b], [a, b])).toBe(true)
  expect(sameEach([a, b], [b, a])).toBe(false)
  expect(sameEach([a], [a, b])).toBe(false)
  expect(sameEach([a], [{ id: "a" }])).toBe(false)
  expect(sameEach([undefined, NaN], [undefined, NaN])).toBe(true)
})
