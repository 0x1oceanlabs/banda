import type { TreeField } from "@banda/contract/apps"
import { expect, test } from "vitest"
import { emptyOf, paramsOf } from "./form"

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
  options: [],
})

const FIELDS = [
  field("name", "text", true),
  field("city", "text"),
  field("age", "number"),
  field("vip", "checkbox"),
]

test("a form starts empty, and a tick starts off", () => {
  expect(emptyOf(FIELDS)).toEqual({ name: "", city: "", age: "", vip: false })
})

test("the params are what was filled: an empty field is left out, a number is a number", () => {
  const filled = { name: " Anna ", city: "", age: "41", vip: true }
  expect(paramsOf(FIELDS, filled)).toEqual({
    params: { name: "Anna", age: 41, vip: true },
  })
})

test("what stops a form is said by field, and nothing is sent", () => {
  // A required field left empty or blank, and a number that does not read.
  const filled = { ...emptyOf(FIELDS), name: "  ", age: "forty" }
  expect(paramsOf(FIELDS, filled)).toEqual({
    amiss: { name: "Name is required.", age: "Age is a number." },
  })
})
