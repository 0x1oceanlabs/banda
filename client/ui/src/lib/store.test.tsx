import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
import { keptSelection, sameEach, Store, useStore } from "./store"

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

test("a reader keeps what it drew while nothing it reads changed", () => {
  const last = keptSelection([1, 2], null, sameEach)
  expect(last.value).toEqual([1, 2])
  expect(keptSelection([1, 2], last, sameEach)).toBe(last)
  const next = keptSelection([1, 3], last, sameEach)
  expect(next).not.toBe(last)
  expect(next.value).toEqual([1, 3])
  // A selection of nothing is one, told from none.
  expect(keptSelection(undefined, null, Object.is)).toEqual({
    value: undefined,
  })
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

test("a reader drawn to text reads what the store holds now", () => {
  const store = new Store({ count: 3, other: "x" })
  function Count() {
    return <>{useStore(store, (value) => value.count)}</>
  }
  expect(renderToStaticMarkup(<Count />)).toBe("3")
})
