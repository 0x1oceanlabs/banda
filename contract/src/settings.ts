/**
 * The settings files, as the settings Pane reads them (ADR 0016): each
 * file's JSON Schema from its Rust structs, turned into rows. A new key in
 * Rust is a new row here, with no list kept by hand (decision 4).
 */
import agents from "./generated/schema/agents.schema.json"
import browser from "./generated/schema/browser.schema.json"
import harnesses from "./generated/schema/harnesses.schema.json"
import look from "./generated/schema/look.schema.json"
import sidebar from "./generated/schema/sidebar.schema.json"
import type { JsonValue } from "./generated/serde_json/JsonValue"

export type { From } from "./generated/look/From"
export type { Setting } from "./generated/look/Setting"

/** The part of JSON Schema the Rust structs give. */
export type Schema = {
  title?: string
  description?: string
  type?: string | string[]
  $ref?: string
  enum?: JsonValue[]
  const?: JsonValue
  oneOf?: Schema[]
  anyOf?: Schema[]
  properties?: { [key: string]: Schema }
  additionalProperties?: boolean | Schema
  items?: Schema
  minimum?: number
  maximum?: number
  $defs?: { [name: string]: Schema }
}

/** Every settings file Banda reads, by name, with its schema. */
export const SCHEMAS: { [file: string]: Schema } = {
  "look.toml": look as Schema,
  "sidebar.toml": sidebar as Schema,
  "browser.toml": browser as Schema,
  "agents.toml": agents as Schema,
  "harnesses.toml": harnesses as Schema,
}

/** One value a key may take, and what it means. */
export type Option = { value: JsonValue; about?: string }

/** How a row is changed. */
export type Control =
  | { kind: "switch" }
  | { kind: "choice"; options: Option[] }
  | { kind: "number"; min?: number; max?: number; integer: boolean }
  /** Words, written as a string. */
  | { kind: "text" }
  /** A value of more than one type, typed as TOML: `12`, or `lg`. */
  | { kind: "free" }
  /** Some of the options, in order. */
  | { kind: "many"; options: Option[] }
  /** Anything else is changed in the file itself. */
  | { kind: "file" }

/** One key of a file, as the window draws it. */
export type Row = {
  file: string
  /** Dotted, as the file and `banda settings set` name it: `tile.border`. */
  key: string
  /** Its table's name, or "" for the file's own keys. */
  group: string
  title: string
  /** Its doc comment in Rust. */
  about: string
  control: Control
}

/** The rows of `file`, in the order its struct has them. */
export function rowsOf(file: string): Row[] {
  const schema = SCHEMAS[file]
  if (!schema) return []
  const rows: Row[] = []
  const walk = (at: Schema, prefix: string[]) => {
    for (const [name, property] of Object.entries(at.properties ?? {})) {
      const resolved = deref(schema, property)
      const path = [...prefix, name]
      if (resolved.properties) {
        walk(resolved, path)
        continue
      }
      rows.push({
        file,
        key: path.join("."),
        group: prefix.join("."),
        title: titleOf(name),
        about: oneLine(property.description ?? resolved.description ?? ""),
        control: controlOf(schema, resolved),
      })
    }
  }
  walk(schema, [])
  return rows
}

/** How a key is changed, from its schema. */
function controlOf(root: Schema, at: Schema): Control {
  const options = optionsOf(root, at)
  if (options) return { kind: "choice", options }
  const type = typeOf(at)
  if (type === "boolean") return { kind: "switch" }
  if (type === "number" || type === "integer") {
    return {
      kind: "number",
      min: at.minimum,
      max: at.maximum,
      integer: type === "integer",
    }
  }
  if (type === "string") return { kind: "text" }
  if (type === "array" && at.items) {
    const items = optionsOf(root, deref(root, at.items))
    return items ? { kind: "many", options: items } : { kind: "file" }
  }
  if (at.anyOf || at.oneOf) return { kind: "free" }
  return { kind: "file" }
}

/** The values a key may take, when they are a list: an enum, `const`s, or
 * a boolean beside them, as a sound that is on, off or another's. */
function optionsOf(root: Schema, at: Schema): Option[] | undefined {
  if (at.enum) return at.enum.map((value) => ({ value }))
  if (at.const !== undefined) {
    return [{ value: at.const, about: oneLine(at.description ?? "") }]
  }
  const ways = at.oneOf ?? at.anyOf
  if (!ways) return undefined
  const options: Option[] = []
  for (const way of ways.map((w) => deref(root, w))) {
    if (typeOf(way) === "boolean" && !way.enum) {
      options.push({ value: true, about: "On" }, { value: false, about: "Off" })
      continue
    }
    const some = optionsOf(root, way)
    if (!some) return undefined
    options.push(...some)
  }
  return options
}

function typeOf(at: Schema): string | undefined {
  return Array.isArray(at.type) ? at.type[0] : at.type
}

/** `#/$defs/Tile` as the schema it names. */
function deref(root: Schema, at: Schema): Schema {
  if (!at.$ref) return at
  const name = at.$ref.replace("#/$defs/", "")
  const found = root.$defs?.[name]
  return found
    ? {
        ...deref(root, found),
        description: at.description ?? found.description,
      }
    : at
}

/** What a file holds: its root struct's doc comment, on one line. */
export function aboutOf(file: string): string {
  return oneLine(SCHEMAS[file]?.description ?? "")
}

/** `dim-inactive` as `Dim inactive`, `line1` as `Line 1`. */
export function titleOf(name: string): string {
  const words = name.replaceAll(/[-_]/g, " ").replace(/(\D)(\d+)$/, "$1 $2")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function oneLine(text: string): string {
  return text.replaceAll(/\s*\n\s*/g, " ").trim()
}

/** A value as `banda settings set` takes it: TOML. */
export function tomlOf(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(tomlOf).join(", ")}]`
  return JSON.stringify(value)
}
