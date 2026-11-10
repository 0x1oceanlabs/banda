/**
 * The Usage Pane's numbers (ADR 0055, decision 4): the engine's rows, by
 * UTC day, Harness entry and model, summed by account, by day and by
 * model, for the accounts the Person left on.
 */
import type {
  HarnessView,
  UsageRow,
  UsageTokens,
  UsageTotal,
} from "@banda/contract/harnesses"
import { emblemColour } from "@banda/ui/components/emblem"
import { DAY } from "@banda/ui/lib/words"

/** A Harness entry, as the Pane names and colours it. */
export type Account = {
  /** The entry's ID, which the rows and the limits name. */
  id: string
  /** The entry's name in harnesses.toml: `Work`. */
  name: string
  /** The Harness it runs, when Banda can tell: `Claude Code`. */
  harness?: string
  /** Its emblem's colour, as CSS (ADR 0093, decision 3): the same in the
   * charts as on the chip and in the picker. */
  colour: string
  /** The key a chart's row keeps its value under. */
  key: string
}

/** The Harness an entry runs, from its program and its variables, as the
 * engine tells Claude Code's second account by its adapter. */
export function harnessOf(view: HarnessView): string | undefined {
  const said = [view.id, ...view.command, ...view.env].join(" ").toLowerCase()
  if (said.includes("codex")) return "Codex"
  if (said.includes("claude")) return "Claude Code"
  return undefined
}

/**
 * The accounts the Pane shows: each entry the usage or the limits name, in
 * the order of harnesses.toml. An entry the list no longer has comes last,
 * named by its ID.
 */
export function accountsOf(
  list: readonly HarnessView[],
  named: Iterable<string>
): Account[] {
  const wanted = new Set(named)
  const accounts: Account[] = []
  list.forEach((view, place) => {
    if (!wanted.delete(view.id)) return
    accounts.push({
      id: view.id,
      name: view.name,
      harness: harnessOf(view),
      colour: emblemColour(view),
      key: `a${place}`,
    })
  })
  let place = list.length
  for (const id of wanted) {
    // One the list no longer has: the text's colour, as an emblem's own.
    accounts.push({
      id,
      name: id,
      colour: "var(--account-own)",
      key: `a${place}`,
    })
    place++
  }
  return accounts
}

/** What a chart counts of a total. */
export type Measure = (total: UsageTotal) => number

export const tokensOf = (tokens: UsageTokens): number =>
  tokens.input + tokens.cache_read + tokens.cache_write + tokens.output

export const COST: Measure = (total) => total.cost_usd
export const TOKENS: Measure = (total) => tokensOf(total.tokens)

const ZERO: UsageTotal = {
  tokens: { input: 0, cache_read: 0, cache_write: 0, output: 0 },
  sessions: 0,
  prompts: 0,
  requests: 0,
  cost_usd: 0,
  unpriced: 0,
}

/** Two totals summed. Sessions add up too, so a session two rows share
 * counts twice: the engine's own total has them once. */
export function plus(a: UsageTotal, b: UsageTotal): UsageTotal {
  return {
    tokens: {
      input: a.tokens.input + b.tokens.input,
      cache_read: a.tokens.cache_read + b.tokens.cache_read,
      cache_write: a.tokens.cache_write + b.tokens.cache_write,
      output: a.tokens.output + b.tokens.output,
    },
    sessions: a.sessions + b.sessions,
    prompts: a.prompts + b.prompts,
    requests: a.requests + b.requests,
    cost_usd: a.cost_usd + b.cost_usd,
    unpriced: a.unpriced + b.unpriced,
  }
}

/** The rows of the accounts that are on. */
export function rowsOn(
  rows: readonly UsageRow[],
  on: ReadonlySet<string>
): UsageRow[] {
  return rows.filter((row) => on.has(row.harness))
}

/** Every row summed. */
export function totalOf(rows: readonly UsageRow[]): UsageTotal {
  return rows.reduce((sum, row) => plus(sum, row.total), ZERO)
}

/** How much of what was read came from the cache; none before any read. */
export function hitRate(tokens: UsageTokens): number | undefined {
  const read = tokens.input + tokens.cache_read
  return read > 0 ? tokens.cache_read / read : undefined
}

/** One day of a chart: its UTC midnight, and each account's value under
 * its key. */
export type Day = { day: number } & { [key: string]: number }

/** The UTC midnight of the day `at` is in. */
export const dayOf = (at: number): number => Math.floor(at / DAY) * DAY

/**
 * Each UTC day from `since` to `until`, an empty one too, with each
 * account's value: a chart stacks them.
 */
export function daysOf(
  rows: readonly UsageRow[],
  accounts: readonly Account[],
  measure: Measure,
  since: number,
  until: number
): Day[] {
  const days: Day[] = []
  const at = new Map<number, Day>()
  for (let day = dayOf(since); day < until; day += DAY) {
    const empty = { day } as Day
    for (const account of accounts) empty[account.key] = 0
    days.push(empty)
    at.set(day, empty)
  }
  const keys = new Map(accounts.map((a) => [a.id, a.key]))
  for (const row of rows) {
    const day = at.get(row.day)
    const key = keys.get(row.harness)
    if (day && key) day[key] = (day[key] ?? 0) + measure(row.total)
  }
  return days
}

/** An account's sum, and its share of every account's. */
export type ByAccount = {
  account: Account
  total: UsageTotal
  value: number
  share: number
}

/** Each account's sum, in the order of harnesses.toml. */
export function byAccount(
  rows: readonly UsageRow[],
  accounts: readonly Account[],
  measure: Measure
): ByAccount[] {
  const sums = accounts.map((account) => {
    const total = totalOf(rows.filter((row) => row.harness === account.id))
    return { account, total, value: measure(total) }
  })
  const all = sums.reduce((sum, each) => sum + each.value, 0)
  return sums.map((each) => ({
    ...each,
    share: all > 0 ? each.value / all : 0,
  }))
}

/** A model's sum, and the accounts that used it. */
export type ByModel = {
  model: string
  value: number
  requests: number
  accounts: Account[]
}

/** Each model's sum, the largest first. */
export function byModel(
  rows: readonly UsageRow[],
  accounts: readonly Account[],
  measure: Measure
): ByModel[] {
  const models = new Map<string, { total: UsageTotal; ids: Set<string> }>()
  for (const row of rows) {
    const model = models.get(row.model) ?? { total: ZERO, ids: new Set() }
    model.total = plus(model.total, row.total)
    model.ids.add(row.harness)
    models.set(row.model, model)
  }
  return [...models]
    .map(([model, { total, ids }]) => ({
      model,
      value: measure(total),
      requests: total.requests,
      accounts: accounts.filter((a) => ids.has(a.id)),
    }))
    .sort((a, b) => b.value - a.value || a.model.localeCompare(b.model))
}

/** The change from `before` to `now`, as a share; none from nothing. */
export function deltaOf(now: number, before: number): number | undefined {
  return before > 0 ? (now - before) / before : undefined
}

/** A change as words: a share while under double, else how many times
 * as much, as `×118` rather than `+11700%`. */
export function changeWords(delta: number): string {
  if (delta < 1) {
    return `${delta >= 0 ? "+" : "−"}${Math.round(Math.abs(delta) * 100)}%`
  }
  const times = delta + 1
  return `×${times < 10 ? times.toFixed(1).replace(/\.0$/, "") : Math.round(times).toLocaleString("en")}`
}

/** A period of the Cost and Tokens tabs. */
export type Period = "24h" | "7d" | "30d" | "90d"

export const PERIODS: readonly Period[] = ["24h", "7d", "30d", "90d"]

/** How the engine keeps them: 92 days back. */
const KEPT = 92 * DAY

/**
 * What a period asks the engine, at `now`: the last 24 hours, or that many
 * UTC days, today's so far the last; and the same length just before, when
 * the engine still keeps it.
 */
export function spanOf(
  period: Period,
  now: number
): {
  since: number
  until: number
  before?: { since: number; until: number }
} {
  const since =
    period === "24h"
      ? now - DAY
      : dayOf(now) - (Number.parseInt(period) - 1) * DAY
  const length = now - since
  const before = { since: since - length, until: since }
  // A minute's room, as the engine reads its clock after the window's.
  return before.since > now - KEPT + 60_000
    ? { since, until: now, before }
    : { since, until: now }
}

/** Dollars, to the cent below 10 and in thousands above 1000. */
export function dollars(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(2)}k`
  return `$${value.toFixed(value < 10 ? 2 : 0)}`
}

/** A count of tokens in short: `840`, `12k`, `3.4M`, `1.2B`. */
export function count(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`
  return `${Math.round(value)}`
}
