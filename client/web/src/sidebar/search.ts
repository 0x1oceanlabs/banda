/**
 * Search in place (ADR 0098, decision 17; spec S12a): what the Person
 * types in the sidebar's Search, read as words and filters, and whether a
 * Thread's row matches it. The words are a title's, every one of them;
 * `is:` takes where a Thread stands or what its card calls, `in:` its
 * Project, `on:` its machine and `by:` its Harness. Several values of one
 * filter take any of them, and the filters all hold at once. Case and
 * accents do not count. Titles only: the messages come with S12c. Pure,
 * so plain tests cover it.
 */
import { NO_PROJECT } from "@banda/ui/lib/projects"
import type { Row } from "./rows"
import { callWordOf, type Word } from "./card"

/** What `is:` takes, in the hint's order. */
export const IS = [
  "asking",
  "failed",
  "done",
  "woke",
  "working",
  "later",
  "archived",
] as const
export type Is = (typeof IS)[number]

/** The filters, in the hint's order. */
export const FILTERS = ["is", "in", "on", "by"] as const
export type Filter = (typeof FILTERS)[number]

/** What the Person typed, read. */
export type Query = {
  /** What was typed, trimmed: what a search with no match names. */
  text: string
  /** The words a title holds, folded. */
  words: string[]
  /** Each filter's values, folded; one typed with no value yet takes
   * every Thread, and is not here. */
  filters: Partial<Record<Filter, string[]>>
}

/** `text` as a search compares it: lower case, no accents. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase()
}

const isFilter = (name: string): name is Filter =>
  (FILTERS as readonly string[]).includes(name)

/** The filter `token` names, if it names one: `is:`, `in:`, `on:` or
 * `by:`, with its value, maybe none yet. */
export function filterOf(
  token: string
): { filter: Filter; value: string } | undefined {
  const at = token.indexOf(":")
  const filter = token.slice(0, at).toLowerCase()
  return at > 0 && isFilter(filter)
    ? { filter, value: token.slice(at + 1) }
    : undefined
}

/** What `text` asks: its words and its filters. Any other word with a
 * colon is a word. */
export function queryOf(text: string): Query {
  const query: Query = { text: text.trim(), words: [], filters: {} }
  for (const token of text.split(/\s+/)) {
    if (!token) continue
    const named = filterOf(token)
    if (!named) query.words.push(fold(token))
    else if (named.value)
      (query.filters[named.filter] ??= []).push(fold(named.value))
  }
  return query
}

/** Each card's call, as `is:` names it. */
const CALLED: Readonly<Record<Word, Is>> = {
  Asks: "asking",
  Failed: "failed",
  Done: "done",
  Woke: "woke",
}

/** What `is:` says of `row` at `now`: where it stands, when it works, is
 * put off or archived; else what its card calls; none for one open. */
export function isOf(row: Row, now: number): Is | undefined {
  switch (row.stand) {
    case "working":
      return "working"
    case "later":
      return "later"
    case "archived":
      return "archived"
  }
  const word = callWordOf(row.listed, now)
  return word && CALLED[word]
}

/** What a search reads of the machines: the names of the one a row is
 * on, by its host, none for this machine's. */
export type Names = (host: string | undefined) => readonly string[]

/** Whether one of `values` is in one of `names`, each folded. */
const anyIn = (values: readonly string[], names: readonly string[]) =>
  values.some((value) => names.some((name) => fold(name).includes(value)))

/**
 * Whether `query` finds `row` at `now`: every word in its title; and
 * each filter typed, by any of its values: `is:` by the start of a word
 * it takes, the others by a part of the name. `names` names its machine.
 */
export function finds(
  { words, filters }: Query,
  row: Row,
  now: number,
  names: Names
): boolean {
  const title = fold(row.listed.title)
  if (!words.every((word) => title.includes(word))) return false
  const is = filters.is
  if (is) {
    const stands = isOf(row, now)
    if (!stands || !is.some((value) => stands.startsWith(value))) return false
  }
  const project = row.project.scratch ? NO_PROJECT : row.project.name
  if (filters.in && !anyIn(filters.in, [project])) return false
  if (filters.on && !anyIn(filters.on, names(row.host))) return false
  const { harness, by } = row.listed
  const harnesses = [harness, by].filter((name) => name !== undefined)
  return !filters.by || anyIn(filters.by, harnesses)
}

/** The filter the Person is typing at the end of `text`, if any, which
 * the hint narrows to: the last word, while it names one. */
export function typing(text: string): Filter | undefined {
  if (/\s$/.test(text)) return undefined
  return filterOf(text.split(/\s+/).at(-1) ?? "")?.filter
}

/** `text` with its last word made `filter:value` and a space after it, as
 * a value picked in the hint completes it; or `filter:` alone, for its
 * value to be typed. A word typed that names no filter stays. */
export function completed(text: string, filter: Filter, value?: string) {
  const words = text.split(/\s+/).filter(Boolean)
  if (!/\s$/.test(text) && filterOf(words.at(-1) ?? "")) words.pop()
  // A value with a space in it is cut at the space, as the words are.
  const first = value?.split(/\s+/)[0]
  const said = [...words, `${filter}:${first ?? ""}`].join(" ")
  return first ? `${said} ` : said
}

/** What the hint offers after each filter, from `rows`: where a Thread
 * stands, then the Projects, the machines, this one first as `here`
 * names it, and the Harnesses of the Threads listed, each once, by name. */
export function valuesOf(
  rows: readonly Row[],
  here: string | undefined
): Record<Filter, string[]> {
  const each = (names: readonly string[]) =>
    [...new Set(names)].sort((a, b) => a.localeCompare(b))
  return {
    is: [...IS],
    in: each(
      rows.map(({ project }) => (project.scratch ? NO_PROJECT : project.name))
    ),
    on: [
      ...(here === undefined ? [] : [here]),
      ...each(rows.flatMap(({ host }) => (host === undefined ? [] : [host]))),
    ],
    by: each(
      rows.flatMap(({ listed }) => {
        const harness = listed.harness ?? listed.by
        return harness === undefined ? [] : [harness]
      })
    ),
  }
}
