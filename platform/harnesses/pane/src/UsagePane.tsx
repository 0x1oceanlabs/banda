/**
 * The Usage Pane `harnesses.usage` (ADR 0043, decision 6; ADR 0055,
 * decisions 4 and 5): each account's limits, and the cost and tokens in
 * the Harnesses' own journals on this machine, by day, account and model.
 * It is the machine's, as the module is: every Project shows the same.
 */
import type {
  HarnessView,
  Limits,
  LimitsNow,
  LimitWindow,
  UsageNow,
} from "@banda/contract/harnesses"
import { PaneHeader } from "@banda/ui/components/pane-header"
import {
  READ_AGAIN,
  useMachineLive,
  type Live,
  type Source,
} from "@banda/ui/hooks/use-live"
import { useNow } from "@banda/ui/hooks/use-now"
import { useRead } from "@banda/ui/hooks/use-read"
import { cn } from "@banda/ui/lib/utils"
import { MINUTE, fullDate } from "@banda/ui/lib/words"
import { definePane, type PaneProps } from "@banda/ui/pane"
import { GaugeIcon } from "lucide-react"
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { elapsedOf, paceOf, paceWords, resetWords, usedOf } from "./limits"
import { Dot, Quiet, Segment, Segments } from "./parts"
import type { Form } from "./Spend"
import { type Account, type Period, PERIODS, accountsOf, spanOf } from "./usage"

export type UsageArgs = {
  tab: "limits" | "cost" | "tokens"
  period: Period
  /** Each tab's chart: Cost an area, Tokens bars, by default. */
  cost: Form
  tokens: Form
}

const START: UsageArgs = {
  tab: "cost",
  period: "30d",
  cost: "area",
  tokens: "bars",
}

export const usagePane = definePane<UsageArgs>({
  kind: "harnesses.usage",
  title: () => "Usage",
  icon: GaugeIcon,
  sheet: true,
  start: START,
  header: false,
  // One Usage per Project: another tab or period is the same Pane.
  identity: () => "usage",
  Pane: UsagePane,
})

/** The charts load with the Pane's first Cost or Tokens, not with the
 * window: Recharts is the heaviest part of the module. */
const Spend = lazy(() =>
  import("./Spend").then(({ Spend }) => ({ default: Spend }))
)

const TABS = [
  ["limits", "Limits"],
  ["cost", "Cost"],
  ["tokens", "Tokens"],
] as const

/** What the Pane reads of the usage: the period, and the one before it. */
export type Counted = UsageNow & { before?: UsageNow }

function UsagePane({ engine, args, update, close }: PaneProps<UsageArgs>) {
  const { tab, period } = { ...START, ...args }
  const now = useNow(MINUTE)
  const list = useRead(
    useCallback(() => engine.call("harnesses.list", {}), [engine])
  )
  const limits = useLimits(engine, now)
  const usage = useUsage(engine, period, now)
  const views = list.state === "ready" ? list.value : NONE
  const accounts = useMemo(
    () =>
      accountsOf(views, [
        ...(limits.state === "ready"
          ? limits.view.limits.map((l) => l.harness)
          : []),
        ...(usage.state === "ready"
          ? usage.view.reads.map((r) => r.harness)
          : []),
      ]),
    [views, limits, usage]
  )
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const on = useMemo(
    () => new Set(accounts.filter((a) => !off.has(a.id)).map((a) => a.id)),
    [accounts, off]
  )
  const shown = accounts.filter((a) => on.has(a.id))
  const plans = new Map(
    limits.state === "ready"
      ? limits.view.limits.map((l) => [l.harness, l.plan])
      : []
  )
  return (
    <div className="@container/usage flex h-full min-h-0 flex-col">
      <PaneHeader title="Usage" icon={usagePane.icon} onClose={close}>
        <span className="shrink-0 font-medium">Usage</span>
        <div
          role="tablist"
          aria-label="Usage"
          className="ml-3 flex gap-4 self-stretch"
        >
          {TABS.map(([id, words]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => update({ ...START, ...args, tab: id })}
              className="-mb-px flex items-center border-b-[1.5px] border-transparent text-[13px] text-muted-foreground transition-colors hover:text-foreground aria-selected:border-foreground aria-selected:text-foreground"
            >
              {words}
            </button>
          ))}
        </div>
        {tab !== "limits" && (
          <div className="flex flex-1 justify-end">
            <Segments label="Period">
              {PERIODS.map((p) => (
                <Segment
                  key={p}
                  pressed={period === p}
                  onClick={() => update({ ...START, ...args, period: p })}
                >
                  {p}
                </Segment>
              ))}
            </Segments>
          </div>
        )}
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-5">
        {accounts.length > 1 && (
          <div className="mb-[18px] -ml-2 flex flex-wrap gap-1">
            {accounts.map((account) => (
              <Toggle
                key={account.id}
                account={account}
                on={on.has(account.id)}
                onClick={() =>
                  setOff((off) => {
                    const next = new Set(off)
                    if (next.has(account.id)) next.delete(account.id)
                    // One account stays on: an empty Pane says nothing.
                    else if (on.size > 1) next.add(account.id)
                    return next
                  })
                }
              />
            ))}
          </div>
        )}
        {tab === "limits" ? (
          <LimitsTab live={limits} accounts={shown} now={now} />
        ) : (
          <SpendTab
            live={usage}
            accounts={shown}
            plans={plans}
            kind={tab}
            period={period}
            form={args[tab] ?? START[tab]}
            onForm={(form) => update({ ...START, ...args, [tab]: form })}
          />
        )}
      </div>
    </div>
  )
}

const NONE: HarnessView[] = []

/** The limits as last read, kept current as the bar's widget keeps them;
 * opening the Pane asks for a read, as opening its popover does. */
function useLimits(
  engine: PaneProps<UsageArgs>["engine"],
  now: number
): Live<LimitsNow> {
  const [round, setRound] = useState(0)
  const source = useMemo<Source<LimitsNow>>(
    () => ({
      read: () => engine.call("harnesses.limits", {}),
      filter: { module: "harnesses", kinds: ["limits_changed"] },
      apply: () => READ_AGAIN,
    }),
    [engine]
  )
  useEffect(() => {
    void engine
      .call("harnesses.limits", { read: true })
      .then(() => setRound((round) => round + 1))
      .catch(() => undefined)
  }, [engine])
  return useMachineLive(engine, source, now + round)
}

/**
 * The period's usage and the one before it, read again each minute: the
 * engine counts the journals each minute while a window is open, and says
 * nothing of it on the log. The first read counts them first.
 */
function useUsage(
  engine: PaneProps<UsageArgs>["engine"],
  period: Period,
  now: number
): Live<Counted> {
  const counted = useRef(false)
  const source = useMemo<Source<Counted>>(
    () => ({
      read: async () => {
        const span = spanOf(period, Date.now())
        const read = !counted.current
        const [usage, before] = await Promise.all([
          engine.call("harnesses.usage", {
            since: span.since,
            until: span.until,
            read,
          }),
          span.before && engine.call("harnesses.usage", span.before),
        ])
        counted.current = true
        return { ...usage, before }
      },
      filter: { module: "harnesses", kinds: ["account_changed"] },
      apply: () => READ_AGAIN,
    }),
    [engine, period]
  )
  return useMachineLive(engine, source, now)
}

function Toggle({
  account,
  on,
  onClick,
}: {
  account: Account
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-[7px] rounded-md px-2 py-1 text-[12.5px] transition-colors hover:bg-muted/60",
        !on && "text-muted-foreground/70"
      )}
    >
      <Dot account={account} on={on} />
      {account.name}
      {account.harness && account.harness !== account.name && (
        <span className="text-muted-foreground/70">{account.harness}</span>
      )}
    </button>
  )
}

function LimitsTab({
  live,
  accounts,
  now,
}: {
  live: Live<LimitsNow>
  accounts: readonly Account[]
  now: number
}) {
  if (live.state === "loading") return <Quiet>Reading the limits…</Quiet>
  if (live.state === "refused") return <Quiet>{live.refusal.message}</Quiet>
  const by = new Map(live.view.limits.map((l) => [l.harness, l]))
  const shown = accounts.flatMap((account) => {
    const limits = by.get(account.id)
    return limits ? [{ account, limits }] : []
  })
  if (shown.length === 0)
    return (
      <Quiet>
        No limits to show: reading them is off, or no account is signed in.
      </Quiet>
    )
  return (
    <div>
      {shown.map(({ account, limits }) => (
        <AccountLimits
          key={account.id}
          account={account}
          limits={limits}
          now={now}
          warn={live.view.warn}
        />
      ))}
    </div>
  )
}

function AccountLimits({
  account,
  limits,
  now,
  warn,
}: {
  account: Account
  limits: Limits
  now: number
  warn: number
}) {
  // TODO: type `email` once the engine's `Limits.email` lands (ADR 0055,
  // step 2).
  const email = (limits as { email?: string }).email
  const about = [account.harness, limits.plan, email].filter(Boolean)
  const pace = limits.windows
    .map((w) => paceWords(w, now))
    .find((words) => words !== undefined)
  return (
    <section
      aria-label={account.name}
      className="border-border py-[18px] not-first:border-t first:pt-0"
    >
      <div className="mb-3.5 flex flex-wrap items-center gap-x-2">
        <span className="inline-flex items-center gap-2 font-medium">
          <Dot account={account} />
          {account.name}
        </span>
        {about.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {about.join(" · ")}
          </span>
        )}
      </div>
      {limits.windows.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-[22px]">
          {limits.windows.map((w) => (
            <WindowLimit key={w.id} window={w} now={now} warn={warn} />
          ))}
        </div>
      )}
      {pace && <p className="mt-3 text-xs text-warning">{pace}</p>}
      {limits.note && (
        <p className="text-xs text-muted-foreground">{limits.note}</p>
      )}
      {limits.failed && (
        <p
          className="mt-2 text-xs text-warning"
          title={fullDate(limits.failed.at)}
        >
          {limits.failed.why}
        </p>
      )}
    </section>
  )
}

/** The share in the colour the bar's widget warns in. */
function toneOf(used: number, warn: number): string | undefined {
  return used >= 100
    ? "text-destructive"
    : used >= warn
      ? "text-warning"
      : undefined
}

function WindowLimit({
  window,
  now,
  warn,
}: {
  window: LimitWindow
  now: number
  warn: number
}) {
  const used = usedOf(window, now)
  const elapsed = elapsedOf(window, now)
  const pace = paceOf(window, now)
  const tone = toneOf(used, warn)
  return (
    <div>
      <div
        className={cn(
          "text-[28px] leading-none font-semibold tracking-[-0.03em] tabular-nums",
          tone
        )}
      >
        {Math.round(used)}
        <small className="ml-px text-sm font-medium text-muted-foreground">
          %
        </small>
      </div>
      <div className="mt-1.5 mb-2.5 flex justify-between gap-2 text-xs text-muted-foreground">
        <span>{window.label}</span>
        {pace && <span className={pace.tone}>{pace.words}</span>}
      </div>
      <div
        className="relative h-[5px] rounded-full bg-muted"
        role="meter"
        aria-label={`${window.label} used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used}
      >
        <div
          className={cn(
            "h-full rounded-full",
            tone ? "bg-current" : "bg-foreground/85",
            tone
          )}
          style={{ width: `${used}%` }}
        />
        {elapsed !== undefined && used < 100 && (
          <span
            className="absolute -top-[3px] h-[11px] w-px bg-muted-foreground/70"
            style={{ left: `${elapsed}%` }}
            title={`Even pace: ${Math.round(elapsed)}% used by now`}
          />
        )}
      </div>
      <p
        className="mt-2 text-[11.5px] text-muted-foreground tabular-nums"
        title={
          window.resets_at === undefined
            ? undefined
            : fullDate(window.resets_at)
        }
      >
        {resetWords(window, now)}
      </p>
    </div>
  )
}

function SpendTab({
  live,
  ...props
}: {
  live: Live<Counted>
  accounts: readonly Account[]
  plans: ReadonlyMap<string, string | undefined>
  kind: "cost" | "tokens"
  period: Period
  form: Form
  onForm: (form: Form) => void
}) {
  if (live.state === "loading") return <Quiet>Counting the usage…</Quiet>
  if (live.state === "refused") return <Quiet>{live.refusal.message}</Quiet>
  if (!live.view.reading)
    return (
      <Quiet>
        Usage reading is off: <code>[usage] read = false</code> in
        harnesses.toml.
      </Quiet>
    )
  return (
    <Suspense fallback={null}>
      <Spend usage={live.view} {...props} />
    </Suspense>
  )
}
