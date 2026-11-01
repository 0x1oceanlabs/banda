/**
 * What the Banda menu lists (ADR 0017): empty, the Recent Threads and the
 * Actions run most; typed into, the Threads, Spaces and Actions that fit
 * the words, then always "New Thread" with them. Plain data, so the
 * window only draws it.
 */
import type { SpaceId, SpaceSummary } from "@banda/contract"
import { waits } from "@banda/ui/components/banda-mark"
import type { Key } from "@banda/ui/lib/keys"
import type { Listed } from "@banda/ui/pane"
import type { Action } from "../actions/actions"
import type { Lists } from "../bar/Watches"
import type { Shell } from "../shell/actions"

/** Where the menu opens: its root, or its Actions, as the key sheet. */
export type At = "root" | "actions"

/** The key that opens the menu, as the sidebar's field shows it. */
export const MENU_KEY: Key = { code: "Space", alt: true }

/** One row, and what choosing it does. */
export type Choice =
  | { kind: "thread"; id: string; space: SpaceId; listed: Listed }
  | { kind: "space"; id: string; space: SpaceSummary }
  | { kind: "action"; id: string; action: Action<Shell> }
  | { kind: "ask"; id: string; words: string }

/** A group of rows under its heading; the fallback row has none. */
export type Group = {
  label: string
  rows: Choice[]
}

/** The Actions an empty menu offers, as T3 Code's palette offers its own. */
export const ROOT_ACTIONS = [
  "thread.new",
  "browser.new",
  "pane.new",
  "calls.answer",
  "overview.toggle",
]

/** How many rows of each group a search shows. */
const SHOWN = { threads: 8, spaces: 5, actions: 8, recent: 6 }

/** The menu's rows for `words`, opened `at` its root or its Actions. */
export function menuOf({
  words,
  at,
  lists,
  spaces,
  actions,
}: {
  words: string
  at: At
  lists: Lists
  spaces: readonly SpaceSummary[]
  actions: readonly Action<Shell>[]
}): Group[] {
  const query = words.trim()
  const actionRows = (found: readonly Action<Shell>[]) =>
    found.map((action): Choice => ({
      kind: "action",
      id: `action:${action.id}`,
      action,
    }))
  if (at === "actions")
    return nonEmpty([
      {
        label: "Actions",
        rows: actionRows(
          query ? ranked(actions, query, (a) => [a.title, a.id]) : actions
        ),
      },
    ])

  const threads = Object.entries(lists).flatMap(([space, listed]) =>
    listed.map((one) => ({
      kind: "thread" as const,
      id: `thread:${space}:${one.id}`,
      space: space as SpaceId,
      listed: one,
    }))
  )
  if (!query) {
    const recent = threads
      .toSorted(
        (a, b) =>
          Number(waits(b.listed.mark)) - Number(waits(a.listed.mark)) ||
          b.listed.changed - a.listed.changed
      )
      .slice(0, SHOWN.recent)
    const offered = ROOT_ACTIONS.flatMap((id) => {
      const action = actions.find((one) => one.id === id)
      return action ? [action] : []
    })
    return nonEmpty([
      { label: "Recent Threads", rows: recent },
      { label: "Actions", rows: actionRows(offered) },
    ])
  }

  return nonEmpty([
    {
      label: "Threads",
      rows: ranked(threads, query, ({ listed }) => [
        listed.title,
        listed.said ?? "",
        listed.calls ?? "",
      ]).slice(0, SHOWN.threads),
    },
    {
      label: "Spaces",
      rows: ranked(spaces, query, (space) => [space.name])
        .slice(0, SHOWN.spaces)
        .map((space): Choice => ({
          kind: "space",
          id: `space:${space.id}`,
          space,
        })),
    },
    {
      label: "Actions",
      rows: actionRows(
        ranked(actions, query, (a) => [a.title, a.id]).slice(0, SHOWN.actions)
      ),
    },
    { label: "", rows: [{ kind: "ask", id: "ask", words: query }] },
  ])
}

/**
 * The things that fit every word of `query`, the best first: a text that
 * is the query, then one that starts with it, then one with a word that
 * starts with it, then one that holds every word. The first text counts
 * most; among equals the list keeps its order.
 */
export function ranked<Thing>(
  things: readonly Thing[],
  query: string,
  texts: (thing: Thing) => string[]
): Thing[] {
  const lower = query.toLowerCase()
  const words = lower.split(/\s+/).filter(Boolean)
  const rank = (thing: Thing) => {
    let best: number | undefined
    texts(thing).forEach((text, place) => {
      const found = rankOf(text.toLowerCase(), lower, words)
      if (found === undefined) return
      const score = found + place * 4
      if (best === undefined || score < best) best = score
    })
    return best
  }
  return things
    .flatMap((thing, order) => {
      const found = rank(thing)
      return found === undefined ? [] : [{ thing, order, rank: found }]
    })
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((found) => found.thing)
}

function rankOf(
  text: string,
  query: string,
  words: string[]
): number | undefined {
  if (text === query) return 0
  if (text.startsWith(query)) return 1
  if (text.includes(` ${query}`) || text.includes(`.${query}`)) return 2
  if (words.every((word) => text.includes(word))) return 3
  return undefined
}

function nonEmpty(groups: Group[]): Group[] {
  return groups.filter((group) => group.rows.length > 0)
}
