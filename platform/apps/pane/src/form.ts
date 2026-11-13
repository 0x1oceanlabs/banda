/**
 * What a Form of an App's screen holds as the Person fills it, and the
 * params it sends: pure, so it is tested without a page.
 */
import type { TreeField } from "@banda/contract/apps"

/** What a field holds: its text as typed, or whether it is ticked. */
export type Filled = Record<string, string | boolean>

/** Each field as it starts: empty, or not ticked. */
export function emptyOf(fields: readonly TreeField[]): Filled {
  return Object.fromEntries(
    fields.map((field) => [field.name, field.kind === "checkbox" ? false : ""])
  )
}

/**
 * The command's params: text as it is, a number as a number, a tick as
 * true or false. A field left empty is left out, so the command's own
 * default stands. What stops it from being sent is said by field, in
 * words for under it, and then nothing is sent: a field the command
 * requires left empty, a number that does not read.
 */
export function paramsOf(
  fields: readonly TreeField[],
  filled: Filled
):
  | { params: Record<string, string | number | boolean> }
  | { amiss: Record<string, string> } {
  const params: Record<string, string | number | boolean> = {}
  const amiss: Record<string, string> = {}
  for (const field of fields) {
    const value = filled[field.name]
    if (field.kind === "checkbox") {
      params[field.name] = value === true
      continue
    }
    const text = String(value ?? "").trim()
    if (text === "") {
      if (field.required) amiss[field.name] = `${field.label} is required.`
    } else if (field.kind !== "number") {
      params[field.name] = text
    } else if (Number.isFinite(Number(text))) {
      params[field.name] = Number(text)
    } else {
      amiss[field.name] = `${field.label} is a number.`
    }
  }
  return Object.keys(amiss).length > 0 ? { amiss } : { params }
}
