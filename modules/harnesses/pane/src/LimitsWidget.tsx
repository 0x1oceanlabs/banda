import type { Limits, LimitsNow, LimitWindow } from "@banda/contract/harnesses"
import { Button } from "@banda/ui/components/button"
import { HarnessLogo } from "@banda/ui/components/harness-logo"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import {
  READ_AGAIN,
  useMachineLive,
  type Source,
} from "@banda/ui/hooks/use-live"
import { useNow } from "@banda/ui/hooks/use-now"
import { cn } from "@banda/ui/lib/utils"
import { MINUTE, ago, fullDate, problem } from "@banda/ui/lib/words"
import type { WidgetProps } from "@banda/ui/module"
import { useMemo, useState } from "react"
import {
  elapsedOf,
  paceWords,
  resetWords,
  staleOf,
  toneOf,
  tooltipOf,
  usedOf,
} from "./limits"

/** The machine's snapshot and event log keep this current even while
 * its popover is closed. Opening requests a provider read; the engine
 * owns the one-minute bound and publishes the result on that same log. */
export function LimitsWidget({ engine }: WidgetProps) {
  const [round, setRound] = useState(0)
  const source = useMemo<Source<LimitsNow>>(
    () => ({
      read: () => engine.call("harnesses.limits", {}),
      filter: { module: "harnesses", kinds: ["limits_changed"] },
      apply: () => READ_AGAIN,
    }),
    [engine]
  )
  // The cached snapshot is cheap to read. Poll it too, as a change to
  // harnesses.toml (including reading off) produces no limits event.
  const now = useNow(MINUTE)
  const live = useMachineLive(engine, source, now + round)
  const [error, setError] = useState<string>()
  if (live.state !== "ready") return null
  const limits = live.view.limits
  const windows = limits.flatMap((l) =>
    l.windows.map((w) => ({ limits: l, used: usedOf(w, now) }))
  )
  if (windows.length === 0) return null
  const fullest = windows.reduce((a, b) => (b.used > a.used ? b : a))
  const words = tooltipOf(limits, now)
  const around = 2 * Math.PI * 8
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) return
        setError(undefined)
        void engine
          .call("harnesses.limits", { read: true })
          .then(() => setRound((round) => round + 1))
          .catch((error) => setError(problem(error)))
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Usage limits: ${words}`}
            title={words}
            className={cn(
              toneOf(fullest.used, live.view.warn),
              fullest.used >= 100
                ? "hover:text-destructive aria-expanded:text-destructive"
                : fullest.used >= live.view.warn
                  ? "hover:text-warning aria-expanded:text-warning"
                  : undefined,
              staleOf(fullest.limits, now) && "opacity-50"
            )}
          />
        }
      >
        <svg
          viewBox="0 0 20 20"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="8" className="opacity-20" />
          <circle
            cx="10"
            cy="10"
            r="8"
            strokeDasharray={around}
            strokeDashoffset={around * (1 - fullest.used / 100)}
            transform="rotate(-90 10 10)"
            className="transition-[stroke-dashoffset]"
          />
        </svg>
      </PopoverTrigger>
      <PopoverContent className="max-h-[min(32rem,80vh)] w-[min(24rem,calc(100vw-2rem))] gap-3 overflow-y-auto">
        <PopoverTitle className="sr-only">Usage limits</PopoverTitle>
        <div className="flex flex-col gap-3">
          {limits.map((l) => (
            <Account
              key={l.harness}
              limits={l}
              now={now}
              warn={live.view.warn}
            />
          ))}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

function Account({
  limits,
  now,
  warn,
}: {
  limits: Limits
  now: number
  warn: number
}) {
  return (
    <section
      aria-label={limits.name}
      className="flex flex-col gap-2 border-border not-first:border-t not-first:pt-3"
    >
      <div className="flex items-center gap-2">
        <HarnessLogo id={limits.harness} name={limits.name} fallback={null} />
        <span className="font-medium">{limits.name}</span>
        {limits.plan && (
          <span className="ml-auto text-xs text-muted-foreground">
            {limits.plan}
          </span>
        )}
      </div>
      {limits.windows.map((w) => (
        <WindowRow key={w.id} window={w} now={now} warn={warn} />
      ))}
      {limits.note && (
        <p className="text-xs text-muted-foreground">{limits.note}</p>
      )}
      <div className="text-xs text-muted-foreground">
        {limits.read_at !== undefined && (
          <p title={fullDate(limits.read_at)}>
            Read {ago(limits.read_at, now)}
            {ago(limits.read_at, now) === "now" ? "" : " ago"}
          </p>
        )}
        {limits.failed && (
          <p className="text-warning" title={fullDate(limits.failed.at)}>
            {limits.failed.why}
          </p>
        )}
      </div>
    </section>
  )
}

function WindowRow({
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
  const pace = paceWords(window, now)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{window.label}</span>
        <span className={cn("font-medium tabular-nums", toneOf(used, warn))}>
          {Math.round(used)}%
        </span>
      </div>
      <div
        className="relative h-1.5 rounded-full bg-foreground/10"
        role="meter"
        aria-label={`${window.label} used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used}
      >
        <div
          className={cn("h-full rounded-full bg-current", toneOf(used, warn))}
          style={{ width: `${used}%` }}
        />
        {elapsed !== undefined && (
          <span
            className="absolute -top-0.5 h-2.5 w-px bg-muted-foreground"
            style={{ left: `${elapsed}%` }}
            title={`Even pace: ${Math.round(elapsed)}% used by now`}
          />
        )}
      </div>
      <p
        className="text-right text-xs text-muted-foreground"
        title={
          window.resets_at === undefined
            ? undefined
            : fullDate(window.resets_at)
        }
      >
        {resetWords(window, now)}
      </p>
      {pace && <p className="text-xs text-warning">{pace}</p>}
    </div>
  )
}
