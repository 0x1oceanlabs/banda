import { expect, test } from "vitest"
import { base64Of, imagesAmong, problemWith, urlOf } from "./images"

test("a message carries four kinds of image, up to 10 MB each", () => {
  expect(problemWith({ type: "image/png", size: 1 })).toBeUndefined()
  expect(problemWith({ type: "image/webp", size: 10 * 1024 * 1024 })).toBe(
    undefined
  )
  expect(problemWith({ type: "image/svg+xml", size: 1 })).toMatch(/PNG, JPEG/)
  expect(problemWith({ type: "image/jpeg", size: 10 * 1024 * 1024 + 1 })).toBe(
    "An image can be at most 10 MB."
  )
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
