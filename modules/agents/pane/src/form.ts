/**
 * A Question's form as a Person fills it in: what they have typed so far,
 * what of it the Harness gets, and how the answer reads afterwards.
 */
import type { Field, FieldValue } from "@bandaso/contract/agents"

/** Each field as typed: text and numbers as strings, a toggle, the picks. */
export type Draft = Record<string, string | boolean | string[]>

/** What the Person filled in, by field. */
export type Values = Record<string, FieldValue>

/** A fresh form: every field at the Harness's default. */
export function draftOf(form: Field[]): Draft {
  return Object.fromEntries(
    form.map(({ id, input }) => {
      switch (input.kind) {
        case "text":
        case "choice":
          return [id, input.default ?? ""]
        case "number":
          return [id, input.default?.toString() ?? ""]
        case "choices":
          return [id, input.default]
        case "toggle":
          return [id, input.default ?? false]
      }
    })
  )
}

/** What the Harness gets: the fields the Person filled, as their kinds. */
export function filled(form: Field[], draft: Draft): Values {
  const values: Values = {}
  for (const { id, input } of form) {
    const typed = draft[id]
    if (input.kind === "toggle") values[id] = typed === true
    else if (Array.isArray(typed)) {
      if (typed.length > 0) values[id] = typed
    } else if (typeof typed === "string" && typed !== "") {
      const number = Number(typed)
      if (input.kind !== "number") values[id] = typed
      else if (Number.isFinite(number)) values[id] = number
    }
  }
  return values
}

/** Whether every field the Harness needs is filled. */
export function ready(form: Field[], draft: Draft): boolean {
  const values = filled(form, draft)
  return form.every((field) => !field.required || field.id in values)
}

/** The answer as a Person reads it: each filled field, by its title. */
export function summary(
  form: Field[],
  values: Values
): { title: string; value: string }[] {
  return form.flatMap(({ id, title, input }) => {
    const value = values[id]
    if (value === undefined) return []
    const name = (v: string) =>
      input.kind === "choice" || input.kind === "choices"
        ? (input.choices.find((c) => c.value === v)?.name ?? v)
        : v
    const read =
      typeof value === "boolean"
        ? value
          ? "Yes"
          : "No"
        : Array.isArray(value)
          ? value.map(name).join(", ")
          : name(String(value))
    return [{ title, value: read }]
  })
}
