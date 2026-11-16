import { expect, test } from "vitest"
import { Elsewhere } from "./elsewhere"

test("the Person looks elsewhere while some machine says so", () => {
  const elsewhere = new Elsewhere()
  const [arc, devbox] = [{}, {}]
  expect(elsewhere.is()).toBe(false)
  elsewhere.say(arc, true)
  elsewhere.say(devbox, true)
  elsewhere.say(arc, false)
  expect(elsewhere.is()).toBe(true)
  // A machine no more heard says nothing.
  elsewhere.say(devbox, false)
  expect(elsewhere.is()).toBe(false)
})
