import { expect, test } from "vitest"
import { LAST, RECENT, recentOf } from "./last"

const kept = (id: number, toasterId?: string) => ({
  id,
  title: `toast ${id}`,
  ...(toasterId ? { toasterId } : {}),
})

test("the bell shows the last toasts, the newest last, so it stands in front, those told away too", () => {
  const history = [1, 2, 3, 4, 5, 6].map((id) =>
    kept(id, id === 6 ? "away" : undefined)
  )
  expect(recentOf(history).map((toast) => toast.id)).toEqual([2, 3, 4, 5, 6])
  expect(recentOf(history)).toHaveLength(LAST)
})

test("what the bell shows again, and the marks of dismissed toasts, are not shown twice", () => {
  const history = [kept(1), kept(2, RECENT), { id: 1, dismiss: true }]
  expect(recentOf(history).map((toast) => toast.id)).toEqual([1])
  expect(recentOf([])).toEqual([])
})
