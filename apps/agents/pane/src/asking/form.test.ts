import type { Field } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { draftOf, filled, problem, ready, summary } from "./form"

const colours = [
  { value: "red", name: "Red" },
  { value: "blue", name: "Blue" },
]
const FORM: Field[] = [
  {
    id: "colour",
    title: "Colour",
    required: true,
    secret: false,
    input: { kind: "choice", choices: colours },
  },
  {
    id: "note",
    title: "Note",
    required: false,
    secret: false,
    input: { kind: "text", longest: 5 },
  },
  {
    id: "count",
    title: "How many",
    required: false,
    secret: false,
    input: { kind: "number", integer: true, default: 2 },
  },
  {
    id: "also",
    title: "Also",
    required: false,
    secret: false,
    input: { kind: "choices", choices: colours, default: [], most: 1 },
  },
  {
    id: "loud",
    title: "Loud",
    required: false,
    secret: false,
    input: { kind: "toggle" },
  },
]

test("a fresh form holds the Harness's defaults", () => {
  expect(draftOf(FORM)).toEqual({
    colour: "",
    note: "",
    count: "2",
    also: [],
    loud: "",
  })
})

test("the Harness gets only what was filled, as each field's kind", () => {
  const draft = { ...draftOf(FORM), colour: "blue", count: "3" }
  expect(filled(FORM, draft)).toEqual({ colour: "blue", count: 3 })
  expect(filled(FORM, { ...draft, loud: false })).toHaveProperty("loud", false)
  expect(filled(FORM, { ...draft, count: "many" })).not.toHaveProperty("count")
  expect(filled(FORM, { ...draft, note: "   " })).not.toHaveProperty("note")
})

test("a form is ready once its required fields are filled", () => {
  const draft = draftOf(FORM)
  expect(ready(FORM, draft)).toBe(false)
  expect(ready(FORM, { ...draft, colour: "red" })).toBe(true)
  expect(ready(FORM, { ...draft, colour: "   " })).toBe(false)
})

test("a form waits while a field holds what it does not take", () => {
  const draft = { ...draftOf(FORM), colour: "red" }
  const [, note, count, also] = FORM
  expect(problem(note, "too long")).toBe("At most 5 characters.")
  expect(problem(note, "ёжики")).toBeUndefined()
  expect(problem(count, "2.5")).toBe("Type a whole number.")
  expect(problem(also, ["red", "blue"])).toBe("At most 1 choice.")
  expect(ready(FORM, { ...draft, note: "too long" })).toBe(false)
  expect(ready(FORM, { ...draft, count: "2.5" })).toBe(false)
})

test("an answer reads by each field's title and each choice's name", () => {
  const values = { colour: "blue", also: ["red", "blue"], loud: true }
  expect(summary(FORM, values)).toEqual([
    { id: "colour", title: "Colour", value: "Blue" },
    { id: "also", title: "Also", value: "Red, Blue" },
    { id: "loud", title: "Loud", value: "Yes" },
  ])
})
