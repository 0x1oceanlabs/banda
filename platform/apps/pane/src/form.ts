/**
 * What a Form of an App's screen holds as the Person fills it, and the
 * params it sends: pure, so it is tested without a page.
 */
import type { TreeField, TreeFieldKind } from "@banda/contract/apps"

/** What a field holds: its text as typed, or whether it is on. */
export type Filled = Record<string, string | boolean>

/** What a field may start from: a row's cell, or what the App wrote. */
export type Given = Record<string, unknown>

/** Whether a field of `kind` is on or off, and not text. */
export function onOrOff(kind: TreeFieldKind): boolean {
  return kind === "checkbox" || kind === "switch"
}

/** Whether a field of `kind` sends a number. */
function counts(kind: TreeFieldKind): boolean {
  return kind === "number" || kind === "slider"
}

/** Each field as it starts: what `given` has for it, or what the App
 * wrote for it, or empty and off. */
export function startOf(fields: readonly TreeField[], given?: Given): Filled {
  return Object.fromEntries(
    fields.map((field) => {
      const value = given?.[field.name] ?? field.value
      if (onOrOff(field.kind)) return [field.name, value === true]
      if (value !== null && value !== undefined)
        return [field.name, String(value)]
      // A slider always stands somewhere: at its least, where unsaid.
      return [field.name, field.kind === "slider" ? `${field.min ?? 0}` : ""]
    })
  )
}

/**
 * The command's params: text as it is, a number as a number, on or off
 * as true or false. A field left empty is left out, so the command's own
 * default stands. What stops it from being sent is said by field, in
 * words for under it, and then nothing is sent: a field the command
 * requires left empty, a number that does not read or is past what its
 * param takes. Text that `given` had and the Person emptied is sent
 * empty, so a row's cell can be cleared.
 */
export function paramsOf(
  fields: readonly TreeField[],
  filled: Filled,
  given?: Given
):
  | { params: Record<string, string | number | boolean> }
  | { amiss: Record<string, string> } {
  const params: Record<string, string | number | boolean> = {}
  const amiss: Record<string, string> = {}
  for (const field of fields) {
    const value = filled[field.name]
    if (onOrOff(field.kind)) {
      params[field.name] = value === true
      continue
    }
    const text = String(value ?? "").trim()
    const { min, max } = field
    if (text === "") {
      if (field.required) amiss[field.name] = `${field.label} is required.`
      else if (
        !counts(field.kind) &&
        typeof given?.[field.name] === "string" &&
        given[field.name] !== ""
      )
        params[field.name] = ""
    } else if (!counts(field.kind)) {
      params[field.name] = text
    } else if (!Number.isFinite(Number(text))) {
      amiss[field.name] = `${field.label} is a number.`
    } else if (typeof min === "number" && Number(text) < min) {
      amiss[field.name] = `${field.label} is at least ${min}.`
    } else if (typeof max === "number" && Number(text) > max) {
      amiss[field.name] = `${field.label} is at most ${max}.`
    } else {
      params[field.name] = Number(text)
    }
  }
  return Object.keys(amiss).length > 0 ? { amiss } : { params }
}
