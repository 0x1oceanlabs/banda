import type { Field } from "@bandaso/contract/agents"
import { expect, test } from "vitest"
import { draftOf, filled, ready, summary } from "./form"

const colours = [
  { value: "red", name: "Red" },
  { value: "blue", name: "Blue" },
]
const FORM: Field[] = [
  {
    id: "colour",
    title: "Colour",
    required: true,
    input: { kind: "choice", choices: colours },
  },
  { id: "note", title: "Note", required: false, input: { kind: "text" } },
  {
    id: "count",
    title: "How many",
    required: false,
    input: { kind: "number", integer: true, default: 2 },
  },
  {
    id: "also",
    title: "Also",
    required: false,
    input: { kind: "choices", choices: colours, default: [] },
  },
  {
    id: "loud",
    title: "Loud",
    required: false,
    input: { kind: "toggle" },
  },
]

test("a fresh form holds the Harness's defaults", () => {
  expect(draftOf(FORM)).toEqual({
    colour: "",
    note: "",
    count: "2",
    also: [],
    loud: false,
  })
})

test("the Harness gets only what was filled, as each field's kind", () => {
  const draft = { ...draftOf(FORM), colour: "blue", count: "3" }
  expect(filled(FORM, draft)).toEqual({ colour: "blue", count: 3, loud: false })
  expect(filled(FORM, { ...draft, count: "many" })).not.toHaveProperty("count")
})

test("a form is ready once its required fields are filled", () => {
  const draft = draftOf(FORM)
  expect(ready(FORM, draft)).toBe(false)
  expect(ready(FORM, { ...draft, colour: "red" })).toBe(true)
})

test("an answer reads by each field's title and each choice's name", () => {
  const values = { colour: "blue", also: ["red", "blue"], loud: true }
  expect(summary(FORM, values)).toEqual([
    { title: "Colour", value: "Blue" },
    { title: "Also", value: "Red, Blue" },
    { title: "Loud", value: "Yes" },
  ])
})
