import { expect, test } from "vitest"
import {
  base64Of,
  fitSize,
  imagesAmong,
  kindProblem,
  sizeProblem,
  urlOf,
} from "./images"

const MB = 1024 * 1024

test("a message carries four kinds of image, 10 MB each, 80 MB together", () => {
  expect(kindProblem("image/png")).toBeUndefined()
  expect(kindProblem("image/webp")).toBeUndefined()
  expect(kindProblem("image/svg+xml")).toMatch(/PNG, JPEG/)
  expect(sizeProblem(10 * MB, 0)).toBeUndefined()
  expect(sizeProblem(10 * MB + 1, 0)).toBe("An image can be at most 10 MB.")
  expect(sizeProblem(10 * MB, 70 * MB)).toBeUndefined()
  expect(sizeProblem(10 * MB, 70 * MB + 1)).toBe(
    "A message's images can be at most 80 MB together."
  )
})

test("an image longer than 2000 pixels on a side is made to fit", () => {
  expect(fitSize({ width: 2000, height: 1000 })).toBeUndefined()
  expect(fitSize({ width: 4000, height: 3000 })).toEqual({
    width: 2000,
    height: 1500,
  })
  expect(fitSize({ width: 100, height: 8000 })).toEqual({
    width: 25,
    height: 2000,
  })
  expect(fitSize({ width: 1, height: 9000 })).toEqual({
    width: 1,
    height: 2000,
  })
})

test("bytes travel as base64 and come back as a data URL", () => {
  expect(base64Of("data:image/png;base64,iVBORw0")).toBe("iVBORw0")
  expect(urlOf({ mime: "image/png", data: "iVBORw0" })).toBe(
    "data:image/png;base64,iVBORw0"
  )
})

test("only images among pasted files count", () => {
  const png = new File(["x"], "a.png", { type: "image/png" })
  const text = new File(["x"], "a.txt", { type: "text/plain" })
  expect(imagesAmong([png, text])).toEqual([png])
})
