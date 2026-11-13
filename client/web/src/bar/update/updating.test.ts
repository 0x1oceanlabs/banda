import { expect, it } from "vitest"
import { shortOf } from "./updating"

it("names a Dev by its number and a Stable whole", () => {
  expect(shortOf("0.1.0-dev.66")).toBe("dev.66")
  expect(shortOf("0.2.0")).toBe("0.2.0")
})
