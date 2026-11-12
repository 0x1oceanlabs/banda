/**
 * Search in place (ADR 0098, decision 17; spec S12a): what the Person
 * types in the sidebar's Search, read as words and filters, and whether a
 * Thread's row matches it. The words are a title's, every one of them;
 * `is:` takes where a Thread stands or what its card calls, `in:` its
 * Project, `on:` its machine and `by:` its Harness. Several values of one
 * filter take any of them, and the filters all hold at once. Case and
 * accents do not count. The messages are each machine's engine's to search
 * (the modules' `ListSearch`, S12c): what to ask them (`planOf`), and what they
 * answered (`answered`, `searchedOf`), which `useSearch.ts` asks for. One
 * away is searched by its titles alone, and says so. Pure, so plain tests
 * cover it.
 */
import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Shown } from "@banda/core"
import type { Finding } from "@banda/ui/module"
import { projectLabel } from "@banda/ui/lib/projects"
import type { Row } from "./rows"
import { callWordOf, type Word } from "./card"
import { keyOf } from "./hold"

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
 * each filter typed, as `narrows` takes it. `names` names its machine.
 */
export function finds(
  query: Query,
  row: Row,
  now: number,
  names: Names
): boolean {
  const title = fold(row.listed.title)
  return (
    query.words.every((word) => title.includes(word)) &&
    narrows(query, row, now, names)
  )
}

/**
 * Whether each filter `query` has takes `row` at `now`, by any of its
 * values, whatever its title says: `is:` by the start of a word it takes,
 * the others by a part of the name. A Thread found by its messages is
 * narrowed so too. `names` names its machine.
 */
export function narrows(
  { filters }: Query,
  row: Row,
  now: number,
  names: Names
): boolean {
  const is = filters.is
  if (is) {
    const stands = isOf(row, now)
    if (!stands || !is.some((value) => stands.startsWith(value))) return false
  }
  if (filters.in && !anyIn(filters.in, [projectLabel(row.project)]))
    return false
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
    in: each(rows.map(({ project }) => projectLabel(project))),
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

/** The name each other machine says it has, by its name in `hosts.toml`:
 * what `on:` reads, and what a search says of where it looked. */
export const hostNames = (hosts: readonly Shown[]): Record<string, string> =>
  Object.fromEntries(hosts.map((host) => [host.name, host.named.name]))

/** A machine's key in a search of the messages: a host's name in
 * `hosts.toml`, as a row's `host` says it; this one's is empty. */
export const HERE = ""

/** The host of the machine `key` names, as a row says it: none for this
 * one. */
const hostOf = (key: string) => (key === HERE ? undefined : key)

/** A machine as a search of the messages reads it (`planOf`): its key,
 * its Projects, and whether the Window reaches it now. */
export type Searchable = {
  key: string
  projects: readonly ProjectSummary[]
  reached: boolean
}

/**
 * What a search asks of the machines' engines (ADR 0098, decision 17):
 * its words, and each machine the Window reaches with the Projects it
 * asks there; and the machines away, which it reads the titles of alone.
 * `key` says it all, so another plan is another run.
 */
export type Plan = {
  key: string
  words: string
  asks: ReadonlyMap<string, readonly ProjectId[]>
  away: readonly string[]
}

/**
 * What `query` asks of `machines`, by their messages: none without a
 * word, as filters alone read no message. Each machine's Projects that
 * list something (`listed`), as `in:`, `on:` and the one Project shown
 * alone (`only`) narrow them, so a filter asks fewer; `names` names a
 * machine as `on:` reads it. A machine with none to ask is left out, as
 * is one away with none to read.
 */
export function planOf(
  { words, filters }: Query,
  machines: readonly Searchable[],
  listed: (project: ProjectId) => boolean,
  names: Names,
  only?: ProjectId
): Plan | undefined {
  if (words.length === 0) return undefined
  const asks = new Map<string, ProjectId[]>()
  const away: string[] = []
  for (const { key, projects, reached } of machines) {
    if (filters.on && !anyIn(filters.on, names(hostOf(key)))) continue
    const asked = projects
      .filter(
        (project) =>
          listed(project.id) &&
          (only === undefined || project.id === only) &&
          (!filters.in || anyIn(filters.in, [projectLabel(project)]))
      )
      .map((project) => project.id)
    if (asked.length === 0) continue
    if (reached) asks.set(key, asked)
    else away.push(key)
  }
  const said = words.join(" ")
  return {
    key: JSON.stringify([said, [...asks], away]),
    words: said,
    asks,
    away,
  }
}

/** A message found, and the machine whose engine found it. */
type FoundOn = { machine: string; found: Finding }

/**
 * What the machines' engines answered a plan so far: its key and words,
 * each message found by its card's key, and which machines answered and
 * which of them failed.
 */
export type Answers = {
  key: string
  words: string
  found: ReadonlyMap<string, FoundOn>
  answered: ReadonlySet<string>
  failed: ReadonlySet<string>
}

export const NO_ANSWERS: Answers = {
  key: "",
  words: "",
  found: new Map(),
  answered: new Set(),
  failed: new Set(),
}

/**
 * `was` with `machine`'s answer to `plan`: what its engine found, or none
 * where it failed. What it found before goes; the other machines' finds
 * stay while the words are the same, as when a filter changed, and go
 * with other words.
 */
export function answered(
  was: Answers,
  plan: Plan,
  machine: string,
  found: readonly Finding[] | undefined
): Answers {
  const same = was.key === plan.key
  const kept =
    was.words === plan.words
      ? [...was.found].filter(([, one]) => one.machine !== machine)
      : []
  const fresh = (found ?? []).map(
    (one) => [keyOf(hostOf(machine), one.id), { machine, found: one }] as const
  )
  return {
    key: plan.key,
    words: plan.words,
    found: new Map([...kept, ...fresh]),
    answered: new Set([...(same ? was.answered : []), machine]),
    failed: new Set([
      ...(same ? [...was.failed].filter((one) => one !== machine) : []),
      ...(found ? [] : [machine]),
    ]),
  }
}

/** What a search of the messages says, as the list draws it: each
 * message found for the words typed now, by its card's key; the machines
 * whose messages it searched (`on`), those away and those whose engine
 * failed, both read by their titles alone; and whether a machine has yet
 * to answer. */
export type Searched = {
  found: ReadonlyMap<string, Finding>
  on: readonly string[]
  away: readonly string[]
  failed: readonly string[]
  pending: boolean
}

/**
 * What `answers` say of `plan`: the messages found for its words, by
 * the machines it asks, though some have not answered it yet; none for
 * other words, so an answer that comes late for words no longer typed
 * shows nothing. None without a plan.
 */
export function searchedOf(
  answers: Answers,
  plan: Plan | undefined
): Searched | undefined {
  if (!plan) return undefined
  const same = answers.key === plan.key
  const asked = [...plan.asks.keys()]
  const failed = same ? asked.filter((one) => answers.failed.has(one)) : []
  const found =
    answers.words === plan.words
      ? [...answers.found].flatMap(([key, one]) =>
          plan.asks.has(one.machine) && !failed.includes(one.machine)
            ? [[key, one.found] as const]
            : []
        )
      : []
  return {
    found: new Map(found),
    on: asked.filter((one) => !failed.includes(one)),
    away: plan.away,
    failed,
    pending: asked.some((one) => !same || !answers.answered.has(one)),
  }
}

/** A snippet's text in pieces, each marked where `hits` say a word is;
 * a hit out of its bounds, or over one before it, marks nothing. */
export function marked({
  snippet,
  hits,
}: Pick<Finding, "snippet" | "hits">): { text: string; hit: boolean }[] {
  const pieces: { text: string; hit: boolean }[] = []
  let at = 0
  for (const { from, to } of hits) {
    if (from < at || to <= from || to > snippet.length) continue
    if (from > at) pieces.push({ text: snippet.slice(at, from), hit: false })
    pieces.push({ text: snippet.slice(from, to), hit: true })
    at = to
  }
  if (at < snippet.length) pieces.push({ text: snippet.slice(at), hit: false })
  return pieces
}
