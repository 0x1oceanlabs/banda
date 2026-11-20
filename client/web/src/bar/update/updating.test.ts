import { expect, it } from "vitest"
import { above, shortOf } from "./updating"

it("names a Dev by its number and a Stable whole", () => {
  expect(shortOf("0.1.0-dev.66")).toBe("dev.66")
  expect(shortOf("0.2.0")).toBe("0.2.0")
})

it("orders versions as the engine does: by number, a plain one above its Devs", () => {
  expect(above("0.1.0-dev.100", "0.1.0-dev.99")).toBe(true)
  expect(above("0.1.0-dev.99", "0.1.0-dev.100")).toBe(false)
  expect(above("0.1.0-dev.99", "0.1.0-dev.99")).toBe(false)
  expect(above("0.1.0", "0.1.0-dev.999")).toBe(true)
  expect(above("0.2.0-dev.1", "0.1.0")).toBe(true)
  expect(above("0.10.0", "0.9.0")).toBe(true)
  // Nothing is above, or below, a version Banda does not publish.
  expect(above("newest", "0.1.0")).toBe(false)
  expect(above("0.1.0", "")).toBe(false)
})
