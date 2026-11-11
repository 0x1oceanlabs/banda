import type {
  Limits,
  LimitsLook,
  LimitsNow,
  LimitWindow,
  UsageNow,
} from "@banda/contract/harnesses"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@banda/ui/components/context-menu"
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@banda/ui/components/dropdown-menu"
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
import { useHarnesses } from "@banda/ui/hooks/use-harnesses"
import { Emblem, emblemOf, type EmblemOf } from "@banda/ui/components/emblem"
import { useRun } from "@banda/core/react"
import { cn } from "@banda/ui/lib/utils"
import { MINUTE, ago, fullDate, problem } from "@banda/ui/lib/words"
import type { WidgetProps } from "@banda/ui/module"
import { useSlot } from "@banda/ui/slots"
import type { Engine } from "@banda/contract"
import { GaugeIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import {
  type Room,
  backWords,
  elapsedOf,
  fullestOf,
  harnessName,
  harnessOf,
  mostRoomOf,
  paceWords,
  readAtOf,
  resetWords,
  roomsOf,
  shareOf,
  shortName,
  someOut,
  staleOf,
  todayWords,
  toneOf,
  tooltipOf,
  usedOf,
} from "./limits"
import { LOOKS, picked } from "./look"

/** A share's colour on the bar: the bar's own until `warn`. */
function loudOf(used: number, warn: number): string | undefined {
  return used >= warn ? toneOf(used, warn) : undefined
}

/** The machine's snapshot and event log keep this current even while
 * its popover is closed. Opening requests a provider read; the engine
 * owns the one-minute bound and publishes the result on that same log. */
export function LimitsWidget({ engine }: WidgetProps) {
  const run = useRun()
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
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  const [usage, setUsage] = useState<UsageNow>()
  // A look picked is written by its action: once it is, the engine reads
  // harnesses.toml as it answers, so read again; refused, say why.
  useEffect(
    () =>
      picked.subscribe(() => {
        const answer = picked.get()
        if (answer?.refused) setError(answer.refused)
        else setRound((round) => round + 1)
      }),
    []
  )
  if (live.state !== "ready") return null
  const { limits, warn, look } = live.view
  const share = shareOf(limits, now)
  if (!share) return null
  const words = tooltipOf(limits, now)
  const pick = (next: LimitsLook) =>
    run("harnesses.limits.look", { look: next })
  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex">
        <Popover
          open={open}
          onOpenChange={(opening) => {
            setOpen(opening)
            if (!opening) return
            setError(undefined)
            void engine
              .call("harnesses.limits", { read: true })
              .then(() => setRound((round) => round + 1))
              .catch((error) => setError(problem(error)))
            void engine
              .call("harnesses.usage", {})
              .then(setUsage)
              .catch(() => setUsage(undefined))
          }}
        >
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={`Usage limits: ${words}`}
                title={words}
                className={cn(
                  "flex h-6 items-center gap-1.5 rounded-control px-2 text-xs text-muted-foreground tabular-nums outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted data-popup-open:text-foreground",
                  staleOf(share.best, now) && "opacity-50"
                )}
              />
            }
          >
            <Look
              look={look}
              share={share.share}
              rooms={roomsOf(limits, now)}
              warn={warn}
            />
            {someOut(limits, now) && (
              <span
                className="-ml-0.5 size-[5px] shrink-0 rounded-full bg-warning"
                aria-hidden="true"
              />
            )}
          </PopoverTrigger>
          <PopoverContent className="max-h-[min(36rem,80vh)] w-[min(340px,calc(100vw-2rem))] gap-0 overflow-y-auto p-0">
            <PopoverTitle className="sr-only">Usage limits</PopoverTitle>
            <Accounts engine={engine} limits={limits} now={now} warn={warn} />
            {error && (
              <p
                role="alert"
                className="border-t border-border px-4 py-2 text-xs text-muted-foreground"
              >
                {error}
              </p>
            )}
            <Foot
              limits={limits}
              usage={usage}
              now={now}
              onUsage={() => {
                setOpen(false)
                run("harnesses.usage")
              }}
            />
          </PopoverContent>
        </Popover>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show the limits as</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={look}
            onValueChange={(next: LimitsLook) => pick(next)}
          >
            {LOOKS.map((one) => (
              <DropdownMenuRadioItem
                key={one.look}
                value={one.look}
                closeOnClick
              >
                {one.words}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** The widget in the look the Person picked (ADR 0055, decision 2). */
export function Look({
  look,
  share,
  rooms,
  warn,
}: {
  look: LimitsLook
  share: number
  rooms: readonly Room[]
  warn: number
}) {
  const loud = loudOf(share, warn)
  const shown = `${Math.round(share)}%`
  switch (look) {
    case "meter":
      return (
        <>
          <span
            className={cn(
              "relative h-[3px] w-[22px] overflow-hidden rounded-full bg-foreground/10",
              loud
            )}
            aria-hidden="true"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-current"
              style={{ width: `${share}%` }}
            />
          </span>
          <span className={loud}>{shown}</span>
        </>
      )
    case "number":
      return <span className={loud}>{shown}</span>
    case "providers":
      return rooms.map((room, i) => (
        <span key={room.harness} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-muted-foreground/60">·</span>}
          <span className="text-muted-foreground/70">
            {shortName(room.harness)}
          </span>
          <span className={loudOf(room.share, warn)}>
            {Math.round(room.share)}%
          </span>
        </span>
      ))
    case "icon":
      return <GaugeIcon className={cn("size-4", loud)} aria-hidden="true" />
  }
}

/** Every account, by Harness (ADR 0055, decision 3). */
function Accounts({
  engine,
  limits,
  now,
  warn,
}: {
  engine: Engine
  limits: readonly Limits[]
  now: number
  warn: number
}) {
  const room = mostRoomOf(limits, now)
  const views = useHarnesses(engine)
  const harnesses = [...new Set(limits.map(harnessOf))]
  return harnesses.flatMap((harness) =>
    limits
      .filter((each) => harnessOf(each) === harness)
      .map((each) => (
        <Account
          key={each.harness}
          engine={engine}
          all={limits}
          limits={each}
          emblem={emblemOf(views, each.harness, each.name)}
          mostRoom={room.has(each.harness)}
          now={now}
          warn={warn}
        />
      ))
  )
}

function Account({
  engine,
  all,
  limits,
  emblem,
  mostRoom,
  now,
  warn,
}: {
  engine: Engine
  /** Every account's limits, for what fills a spent one's Slot. */
  all: readonly Limits[]
  limits: Limits
  /** The account's emblem, as the composer's chip and the picker show it
   * (ADR 0093, decision 1). */
  emblem: EmblemOf
  mostRoom: boolean
  now: number
  warn: number
}) {
  const out = limits.windows.length > 0 && fullestOf(limits, now) >= 100
  // Beside a spent account, what the modules say waits on it: Threads'
  // "Move all" (ADR 0078, decision 7).
  const spent = useSlot("limits.account")
  const pace = limits.windows
    .map((w) => paceWords(w, now))
    .find((words) => words !== undefined)
  // A Harness's own entry is named by it already: "Codex", not "Codex Codex".
  const harness = harnessName(limits)
  const what = [harness === limits.name ? undefined : harness, limits.plan]
    .filter(Boolean)
    .join(" · ")
  return (
    <section
      aria-label={limits.name}
      className="flex flex-col border-t border-border px-4 py-3.5 first-of-type:border-t-0"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <Emblem of={emblem} named nameClassName="truncate font-medium" />
        </span>
        <span
          className="truncate text-xs text-muted-foreground/70"
          title={limits.email}
        >
          {what}
        </span>
        {out ? (
          <span className="ml-auto shrink-0 text-meta text-destructive">
            {backWords(limits, now)}
          </span>
        ) : (
          mostRoom && (
            <span className="ml-auto shrink-0 text-meta text-muted-foreground">
              most room
            </span>
          )
        )}
      </div>
      {limits.windows.slice(0, 2).map((w) => (
        <WindowRow key={w.id} window={w} now={now} warn={warn} />
      ))}
      {pace && <p className="mt-2 text-xs text-warning">{pace}</p>}
      {limits.note && (
        <p className="text-xs text-muted-foreground">{limits.note}</p>
      )}
      {limits.failed && (
        <p
          className="mt-1 text-xs text-muted-foreground"
          title={fullDate(limits.failed.at)}
        >
          {limits.failed.why}
        </p>
      )}
      {out &&
        spent.map(({ id, Fill }) => (
          <Fill
            key={id}
            engine={engine}
            account={limits.harness}
            limits={all}
            now={now}
          />
        ))}
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
  const loud = loudOf(used, warn)
  return (
    <div
      className="grid h-5 grid-cols-[56px_1fr_34px] items-center gap-2.5 text-xs"
      title={`${window.label}: ${resetWords(window, now)}${window.resets_at === undefined ? "" : `, ${fullDate(window.resets_at)}`}`}
    >
      <span className="truncate text-muted-foreground">{window.label}</span>
      <div
        className="relative h-1 rounded-full bg-foreground/10"
        role="meter"
        aria-label={`${window.label} used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            used >= 100
              ? "bg-destructive"
              : used >= warn
                ? "bg-warning"
                : "bg-foreground/85"
          )}
          style={{ width: `${used}%` }}
        />
        {elapsed !== undefined && used < 100 && (
          <span
            className="absolute -top-[3px] h-2.5 w-px bg-muted-foreground/70"
            style={{ left: `${elapsed}%` }}
            title={`Even pace: ${Math.round(elapsed)}% used by now`}
          />
        )}
      </div>
      <span className={cn("text-right tabular-nums", loud)}>
        {Math.round(used)}%
      </span>
    </div>
  )
}

/** Today's usage, when the limits were read, and the way to the Pane. */
function Foot({
  limits,
  usage,
  now,
  onUsage,
}: {
  limits: readonly Limits[]
  usage: UsageNow | undefined
  now: number
  onUsage: () => void
}) {
  const today = todayWords(usage)
  const read = readAtOf(limits)
  const since = read === undefined ? undefined : ago(read, now)
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted-foreground/70">
      <div className="flex min-w-0 flex-col tabular-nums">
        {today && <span className="truncate">{today}</span>}
        {read !== undefined && (
          <span title={fullDate(read)}>
            Read {since}
            {since === "now" ? "" : " ago"}
          </span>
        )}
      </div>
      <button
        type="button"
        className="shrink-0 rounded-small font-medium text-foreground outline-none hover:underline hover:underline-offset-3 focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={onUsage}
      >
        Usage →
      </button>
    </div>
  )
}
