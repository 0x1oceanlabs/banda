/**
 * A Question's form as a Person fills it in: what they have typed so far,
 * what of it the Harness gets, and how the answer reads afterwards.
 */
import type { Field, FieldValue } from "@bandaso/contract/agents"

/** Each field as typed: text and numbers as strings, a toggle, the picks.
 * An empty string is a field left alone, a toggle among them. */
export type Draft = Record<string, string | boolean | string[]>

/** What the Person filled in, by field. */
export type Values = Record<string, FieldValue>

/** A fresh form: every field at the Harness's default. A toggle the
 * Person must answer starts off; any other without a default, untouched. */
export function draftOf(form: Field[]): Draft {
  return Object.fromEntries(
    form.map(({ id, required, input }) => {
      switch (input.kind) {
        case "text":
        case "choice":
          return [id, input.default ?? ""]
        case "number":
          return [id, input.default?.toString() ?? ""]
        case "choices":
          return [id, input.default]
        case "toggle":
          return [id, input.default ?? (required ? false : "")]
      }
    })
  )
}

/** The value a field gets from what was typed in it, or none when it was
 * left alone. Text of spaces only counts as left alone. */
function valueOf(
  { input }: Field,
  typed: Draft[string] | undefined
): FieldValue | undefined {
  if (typeof typed === "boolean") return typed
  if (Array.isArray(typed)) return typed.length > 0 ? typed : undefined
  if (typed === undefined || typed.trim() === "") return undefined
  if (input.kind === "number") return Number(typed.trim())
  if (input.kind === "text" && input.format === "date_time") {
    // The picker gives local time; the Harness gets it with its offset.
    const at = new Date(typed)
    return Number.isNaN(at.getTime()) ? typed : at.toISOString()
  }
  return typed
}

/** Why what was typed in a field does not fit it, as the Person reads it. */
export function problem(
  field: Field,
  typed: Draft[string] | undefined
): string | undefined {
  const value = valueOf(field, typed)
  if (value === undefined) return undefined
  const { input } = field
  switch (input.kind) {
    case "number": {
      const number = Number(value)
      if (!Number.isFinite(number)) return "Type a number."
      if (input.integer && !Number.isInteger(number))
        return "Type a whole number."
      if (input.minimum !== undefined && number < input.minimum)
        return `At least ${input.minimum}.`
      if (input.maximum !== undefined && number > input.maximum)
        return `At most ${input.maximum}.`
      return undefined
    }
    case "text":
      // Characters as the engine counts them, not UTF-16 halves.
      return outside(
        [...String(value)].length,
        input.shortest,
        input.longest,
        "character"
      )
    case "choices":
      return outside(
        Array.isArray(value) ? value.length : 0,
        input.fewest,
        input.most,
        "choice"
      )
    default:
      return undefined
  }
}

function outside(
  count: number,
  fewest: number | undefined,
  most: number | undefined,
  what: string
): string | undefined {
  const of = (n: number) => `${n} ${what}${n === 1 ? "" : "s"}`
  if (fewest !== undefined && count < fewest) return `At least ${of(fewest)}.`
  if (most !== undefined && count > most) return `At most ${of(most)}.`
  return undefined
}

/** What the Harness gets: the fields the Person filled, as their kinds. */
export function filled(form: Field[], draft: Draft): Values {
  const values: Values = {}
  for (const field of form) {
    const value = valueOf(field, draft[field.id])
    if (value === undefined) continue
    if (typeof value === "number" && !Number.isFinite(value)) continue
    values[field.id] = value
  }
  return values
}

/** Whether the form can go: every field it needs is filled, and every
 * field filled takes what was typed in it. */
export function ready(form: Field[], draft: Draft): boolean {
  const values = filled(form, draft)
  return form.every(
    (field) =>
      (!field.required || field.id in values) &&
      problem(field, draft[field.id]) === undefined
  )
}

/** The answer as a Person reads it: each filled field, by its title. */
export function summary(
  form: Field[],
  values: Values
): { id: string; title: string; value: string }[] {
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
    return [{ id, title, value: read }]
  })
}
