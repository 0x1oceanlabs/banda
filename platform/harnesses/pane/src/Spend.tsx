/**
 * The Cost and Tokens tabs of the Usage Pane (ADR 0055, decision 4): the
 * sum, a chart of each day stacked by account, and the sums by account
 * and by model.
 */
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@banda/ui/components/chart"
import { ChartAreaIcon, ChartColumnStackedIcon } from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts"
import { Dot, Quiet, Segment, Segments } from "./parts"
import type { Counted } from "./UsagePane"
import {
  type Account,
  COST,
  type Period,
  TOKENS,
  byAccount,
  byModel,
  count,
  daysOf,
  changeWords,
  deltaOf,
  dollars,
  hitRate,
  rowsOn,
  tokensOf,
  totalOf,
} from "./usage"

/** How the chart draws the days. */
export type Form = "area" | "bars"

const PREVIOUS: Record<Period, string> = {
  "24h": "previous 24h",
  "7d": "previous 7 days",
  "30d": "previous 30 days",
  "90d": "previous 90 days",
}

/** An account as a row names it: `Work · Claude`. */
const nameOf = (a: Account) =>
  a.harness && a.harness !== a.name
    ? `${a.name} · ${a.harness.split(" ")[0]}`
    : a.name

/** A UTC day, as the chart's axis and tooltip name it. */
const dayWords = (day: number) =>
  new Date(day).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

export function Spend({
  usage,
  accounts,
  plans,
  kind,
  period,
  form,
  onForm,
}: {
  usage: Counted
  accounts: readonly Account[]
  plans: ReadonlyMap<string, string | undefined>
  kind: "cost" | "tokens"
  period: Period
  form: Form
  onForm: (form: Form) => void
}) {
  const cost = kind === "cost"
  const measure = cost ? COST : TOKENS
  const write = cost ? dollars : count
  const on = new Set(accounts.map((a) => a.id))
  const rows = rowsOn(usage.rows, on)
  const total = totalOf(rows)
  const value = measure(total)
  const before = usage.before && measure(totalOf(rowsOn(usage.before.rows, on)))
  const delta = before === undefined ? undefined : deltaOf(value, before)
  if (rows.length === 0)
    return (
      <Quiet>
        No usage counted in the{" "}
        {period === "24h"
          ? "last 24 hours"
          : `last ${period.slice(0, -1)} days`}
        .
      </Quiet>
    )
  const accountsBy = byAccount(rows, accounts, measure)
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3.5">
        <div className="text-figure leading-none font-semibold tracking-[-0.035em] tabular-nums">
          {write(value)}
        </div>
        <div className="pb-[5px] text-meta text-muted-foreground">
          {cost ? "API estimate, not what your plans cost" : "tokens"}
          {cost && total.unpriced > 0 && (
            <span className="text-warning">
              {" "}
              · {total.unpriced.toLocaleString("en")} requests unpriced
            </span>
          )}
        </div>
        {delta !== undefined && (
          <div className="ml-auto pb-[5px] text-meta text-muted-foreground tabular-nums">
            {changeWords(delta)} vs {PREVIOUS[period]}
          </div>
        )}
      </div>
      {!cost && <Split tokens={total.tokens} />}
      <div className="mt-[22px] flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {period === "24h"
            ? "By account, last 24 hours"
            : `${cost ? "Cost" : "Tokens"} per day`}
        </span>
        {period !== "24h" && (
          <Segments label="Chart">
            <Segment
              pressed={form === "area"}
              title="Area"
              aria-label="Area"
              onClick={() => onForm("area")}
              className="px-1.5"
            >
              <ChartAreaIcon className="size-3.5" />
            </Segment>
            <Segment
              pressed={form === "bars"}
              title="Bars"
              aria-label="Bars"
              onClick={() => onForm("bars")}
              className="px-1.5"
            >
              <ChartColumnStackedIcon className="size-3.5" />
            </Segment>
          </Segments>
        )}
      </div>
      {period === "24h" ? (
        <Shares shares={accountsBy} write={write} />
      ) : (
        <DaysChart
          days={daysOf(rows, accounts, measure, usage.since, usage.until)}
          accounts={accounts}
          form={form}
          write={write}
          wide={period === "90d" || period === "30d"}
        />
      )}
      <div className="mt-[22px] grid grid-cols-1 gap-7 border-t border-border pt-5 @[40rem]/usage:grid-cols-2">
        <div>
          <p className="mb-2.5 text-xs text-muted-foreground">By account</p>
          {accountsBy.map(({ account, total, value, share }) => {
            const plan = plans.get(account.id)
            return (
              <div
                key={account.id}
                className="grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-0.5 py-2 text-ui"
              >
                <span className="inline-flex items-center gap-2">
                  <Dot account={account} />
                  {account.name}
                  {account.harness && account.harness !== account.name && (
                    <span className="text-muted-foreground/70">
                      {account.harness}
                    </span>
                  )}
                </span>
                <span className="tabular-nums">{write(value)}</span>
                <span className="text-meta text-muted-foreground">
                  {[plan, `${total.prompts.toLocaleString("en")} prompts`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="text-right text-meta text-muted-foreground tabular-nums">
                  {Math.round(share * 100)}%
                </span>
                <div className="relative col-span-2 mt-1.5 h-0.5 rounded-full bg-muted">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${share * 100}%`,
                      background: account.colour,
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
        <div>
          <p className="mb-2.5 text-xs text-muted-foreground">By model</p>
          {byModel(rows, accounts, measure).map((m) => (
            <div
              key={m.model}
              className="grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-0.5 py-2 text-ui"
            >
              <span className="truncate font-mono text-code">
                {m.model}
              </span>
              <span className="tabular-nums">{write(m.value)}</span>
              <span className="text-meta text-muted-foreground">
                {m.accounts.map(nameOf).join(", ")}
              </span>
              <span className="text-right text-meta text-muted-foreground tabular-nums">
                {m.requests.toLocaleString("en")} req
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Input, cache read, cache write and output, in shades of the text. */
function Split({ tokens }: { tokens: Counted["total"]["tokens"] }) {
  const all = tokensOf(tokens)
  const parts = [
    ["Input", tokens.input, "bg-foreground/28"],
    ["Cache read", tokens.cache_read, "bg-foreground/50"],
    ["Cache write", tokens.cache_write, "bg-foreground/70"],
    ["Output", tokens.output, "bg-foreground/92"],
  ] as const
  const hit = hitRate(tokens)
  return (
    <div>
      <div className="mt-[18px] mb-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        {all > 0 &&
          parts.map(([name, value, shade]) => (
            <span
              key={name}
              className={shade}
              style={{ flex: value / all }}
              title={`${name}: ${count(value)}`}
            />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-[22px] gap-y-1 text-xs text-muted-foreground">
        {parts.map(([name, value]) => (
          <span key={name}>
            {name}
            <b className="ml-1.5 font-medium text-foreground tabular-nums">
              {count(value)}
            </b>
          </span>
        ))}
        {hit !== undefined && (
          <span className="text-muted-foreground/70">
            cache hit {Math.round(hit * 100)}%
          </span>
        )}
      </div>
    </div>
  )
}

/** The 24 hours' sums are by day too, so no chart over time: the accounts'
 * shares in one stacked bar. */
function Shares({
  shares,
  write,
}: {
  shares: ReturnType<typeof byAccount>
  write: (value: number) => string
}) {
  return (
    <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
      {shares
        .filter((s) => s.value > 0)
        .map(({ account, value, share }) => (
          <span
            key={account.id}
            style={{ flex: share, background: account.colour }}
            title={`${account.name}: ${write(value)}, ${Math.round(share * 100)}%`}
          />
        ))}
    </div>
  )
}

function DaysChart({
  days,
  accounts,
  form,
  write,
  wide,
}: {
  days: ReturnType<typeof daysOf>
  accounts: readonly Account[]
  form: Form
  write: (value: number) => string
  wide: boolean
}) {
  const config: ChartConfig = Object.fromEntries(
    accounts.map((a) => [
      a.key,
      {
        label:
          a.harness && a.harness !== a.name
            ? `${a.name} · ${a.harness}`
            : a.name,
        color: a.colour,
      },
    ])
  )
  const place = new Map(accounts.map((a, i) => [a.key, i]))
  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey="day"
        tickLine={false}
        axisLine={false}
        tickMargin={10}
        minTickGap={40}
        tickFormatter={dayWords}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={52}
        tickMargin={6}
        tickCount={4}
        tickFormatter={write}
      />
      <ChartTooltip
        // The top of the stack first, as the chart draws it.
        itemSorter={(item) => -(place.get(String(item.dataKey)) ?? 0)}
        content={
          <ChartTooltipContent
            indicator="line"
            className="min-w-44"
            labelFormatter={(_, payload) =>
              dayWords(Number(payload[0]?.payload?.day))
            }
            value={write}
            total="Total"
          />
        }
      />
    </>
  )
  const margin = { top: 6, right: 6, left: 0, bottom: 0 }
  return (
    <ChartContainer
      config={config}
      className="mt-1.5 -mr-1.5 -ml-3.5 aspect-auto h-[260px] w-auto"
    >
      {form === "area" ? (
        <AreaChart data={days} margin={margin}>
          <defs>
            {accounts.map((a) => (
              <linearGradient
                key={a.key}
                id={`usage-${a.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="5%" stopColor={a.colour} stopOpacity={0.32} />
                <stop offset="95%" stopColor={a.colour} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          {axes}
          {accounts.map((a) => (
            <Area
              key={a.key}
              dataKey={a.key}
              type="monotone"
              stackId="1"
              stroke={a.colour}
              strokeWidth={1.5}
              fill={`url(#usage-${a.key})`}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      ) : (
        <BarChart data={days} margin={margin} barCategoryGap={wide ? 1 : 3}>
          {axes}
          {accounts.map((a, i) => (
            <Bar
              key={a.key}
              dataKey={a.key}
              stackId="1"
              fill={a.colour}
              stroke="var(--background)"
              strokeWidth={1}
              radius={i === accounts.length - 1 ? [3, 3, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      )}
    </ChartContainer>
  )
}
