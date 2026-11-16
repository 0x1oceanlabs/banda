import type { TreeField } from "@banda/contract/apps"
import { expect, test } from "vitest"
import { paramsOf, startOf } from "./form"

const field = (
  name: string,
  kind: TreeField["kind"],
  required = false
): TreeField => ({
  name,
  label: name[0]!.toUpperCase() + name.slice(1),
  kind,
  required,
  placeholder: null,
  about: null,
  value: null,
  min: null,
  max: null,
  step: null,
  options: [],
})

const FIELDS = [
  field("name", "text", true),
  field("city", "text"),
  field("age", "number"),
  field("vip", "checkbox"),
]

test("a form starts empty, and a tick starts off", () => {
  expect(startOf(FIELDS)).toEqual({ name: "", city: "", age: "", vip: false })
})

test("the params are what was filled: an empty field is left out, a number is a number", () => {
  const filled = { name: " Anna ", city: "", age: "41", vip: true }
  expect(paramsOf(FIELDS, filled)).toEqual({
    params: { name: "Anna", age: 41, vip: true },
  })
})

test("what stops a form is said by field, and nothing is sent", () => {
  // A required field left empty or blank, and a number that does not read.
  const filled = { ...startOf(FIELDS), name: "  ", age: "forty" }
  expect(paramsOf(FIELDS, filled)).toEqual({
    amiss: { name: "Name is required.", age: "Age is a number." },
  })
})

test("a field starts from what it is given, then from what the App wrote", () => {
  const fields = [
    { ...field("name", "text"), value: "Anna" },
    { ...field("age", "slider"), value: 30 },
    field("vip", "switch"),
  ]
  expect(startOf(fields)).toEqual({ name: "Anna", age: "30", vip: false })
  const given = { name: "Boris", vip: true, other: 1 }
  expect(startOf(fields, given)).toEqual({
    name: "Boris",
    age: "30",
    vip: true,
  })
  // A slider sends a number, a switch true or false.
  expect(paramsOf(fields, startOf(fields, given))).toEqual({
    params: { name: "Boris", age: 30, vip: true },
  })
})

test("a slider starts at its least, a number is held to what its param takes, and text a row had can be emptied", () => {
  const score = { ...field("score", "slider"), min: 1, max: 10 }
  const age = { ...field("age", "number"), min: 0, max: 150 }
  const fields = [score, age, field("city", "text")]
  expect(startOf(fields).score).toBe("1")
  const filled = { score: "1", age: "200", city: "" }
  expect(paramsOf(fields, filled)).toEqual({
    amiss: { age: "Age is at most 150." },
  })
  // Emptied where the row had text, it is sent empty; where it had
  // none, it is left out.
  expect(paramsOf(fields, { ...filled, age: "" }, { city: "Berlin" })).toEqual({
    params: { score: 1, city: "" },
  })
  expect(paramsOf(fields, { ...filled, age: "" }, { city: null })).toEqual({
    params: { score: 1 },
  })
})
