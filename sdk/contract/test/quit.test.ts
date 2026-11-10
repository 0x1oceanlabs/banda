import { expect, test } from "vitest"
import { quitAsks } from "../src/quit"

test("Quit asks in one set of words how many Agents work here, Cancel the default (ADR 0086, decision 3)", () => {
  expect(quitAsks(1, true)).toEqual({
    title: "An Agent works on this Mac",
    detail: "Quitting Banda stops it too.",
    quit: "Quit anyway",
    cancel: "Cancel",
  })
  expect(quitAsks(2, true)).toEqual({
    title: "2 Agents work on this Mac",
    detail: "Quitting Banda stops them too.",
    quit: "Quit anyway",
    cancel: "Cancel",
  })
  expect(quitAsks(3, false)?.title).toBe("3 Agents work on this computer")
})

test("with nobody at work Quit asks nothing", () => {
  expect(quitAsks(0, true)).toBeNull()
  expect(quitAsks(0, false)).toBeNull()
})
