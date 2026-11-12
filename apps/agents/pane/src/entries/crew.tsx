/**
 * A Crew's card, the one thing a Crew puts in its Thread, where Claude
 * started it (ADR 0103, decision 18; mock 02): three satellites, "Crew ·
 * audit-routes" and its description; its strip of phases and dots, a
 * phase past 24 a bar; one quiet line of what its script last logged;
 * its foot's counts, the failed alone in red, its time, which does not
 * tick, and Open. A dot's tooltip names its agent, and a click opens it
 * in the Crew Pane. A Lost Crew offers Ask Claude to go on, a ready
 * message in the composer (decision 26). Banda shows a Crew and stops
 * none of it (call 11).
 */
import { ChevronRightIcon, CheckIcon } from "lucide-react"
import type { CrewState } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { Satellite } from "@banda/ui/components/satellite"
import { SATELLITE_COLOURS, type SatelliteState } from "@banda/ui/lib/satellite"
import { cn } from "@banda/ui/lib/utils"
import { useNow } from "@banda/ui/hooks/use-now"
import type { EntryProps } from "./types"
import { useThreadAround } from "../thread/context"
import {
  type Count,
  footOf,
  footWords,
  goOnMessage,
  quietOf,
  type StripPhase,
  stripOf,
} from "../thread/crew"

const MINUTE = 60_000

export function CrewEntry({ crew }: EntryProps<"crew">) {
  const { acts } = useThreadAround()
  // Its time moves by the minute while it works: only the live line
  // counts the seconds (decision 20).
  const now = useNow(MINUTE, crew?.state === "working")
  if (!crew) return null
  const foot = footOf(crew, now)
  const quiet = quietOf(crew)
  const open = acts.openCrew && (() => acts.openCrew?.(crew.id))
  return (
    <div
      role="group"
      aria-label={`Crew ${crew.title}`}
      data-slot="crew"
      data-state={crew.state}
      className="flex min-w-0 flex-col gap-2.5 rounded-card border bg-block py-3 pr-2.5 pl-3.5 text-ui"
      onKeyDown={(event) => {
        // Enter opens it, from the card itself (decision 18).
        if (event.key === "Enter" && event.target === event.currentTarget)
          open?.()
      }}
      tabIndex={open ? 0 : undefined}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 whitespace-nowrap",
          crew.state === "done" && "opacity-85"
        )}
      >
        <CrewGlyph state={crew.state} />
        <span className="shrink-0 font-[550]">
          <span className="font-medium text-muted-foreground">Crew · </span>
          {crew.title}
        </span>
        {crew.description && (
          <span className="min-w-0 truncate text-muted-foreground">
            {crew.description}
          </span>
        )}
      </div>
      <Strip
        phases={stripOf(crew)}
        className={cn(
          crew.state === "done" && "opacity-85",
          crew.state === "lost" && "opacity-80"
        )}
        onOpen={acts.openCrew && ((agent) => acts.openCrew?.(crew.id, agent))}
      />
      {quiet && (
        <p className="-mt-0.5 flex min-w-0 items-center gap-1 text-meta whitespace-nowrap text-muted-foreground">
          <ChevronRightIcon
            aria-hidden
            className="size-3 shrink-0 text-sub-faint"
          />
          <span className="min-w-0 truncate">{quiet}</span>
        </p>
      )}
      <div
        aria-label={footWords(foot)}
        className="flex min-h-6 items-center gap-2 text-meta whitespace-nowrap text-muted-foreground tabular-nums"
      >
        <span className="min-w-0 truncate">
          <Counts counts={foot.counts} />
        </span>
        {foot.time && (
          <span className="shrink-0 text-sub-faint">· {foot.time}</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {foot.goOn && acts.draft && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => acts.draft?.(goOnMessage(crew))}
            >
              Ask Claude to go on
            </Button>
          )}
          {open && (
            <Button
              variant="ghost"
              size="xs"
              aria-keyshortcuts="Enter"
              onClick={open}
            >
              Open
            </Button>
          )}
        </span>
      </div>
    </div>
  )
}

/** The colour a count takes: only what asks, and what failed. */
const TONES: Record<NonNullable<Count["tone"]>, string> = {
  asks: "text-attention",
  failed: "text-destructive",
}

function Counts({ counts }: { counts: Count[] }) {
  return counts.map((count, at) => (
    <span key={at}>
      {at > 0 && " · "}
      <span className={count.tone && TONES[count.tone]}>{count.words}</span>
    </span>
  ))
}

/** The Crew's glyph: three satellites in a small cluster, at work, done or
 * Lost as the Crew is. */
const GLYPH: Record<CrewState, SatelliteState> = {
  working: "working",
  done: "done",
  failed: "failed",
  stopped: "stopped",
  lost: "lost",
}

export function CrewGlyph({ state }: { state: CrewState }) {
  const look = GLYPH[state]
  return (
    <span aria-hidden className="relative block size-4 shrink-0">
      <Satellite
        state={look}
        size={8}
        className="absolute top-0 left-1/2 -translate-x-1/2"
      />
      <Satellite state={look} size={8} className="absolute bottom-0 left-0" />
      <Satellite state={look} size={8} className="absolute right-0 bottom-0" />
    </span>
  )
}

/** The strip: each phase's name and its agents, one line always; a click
 * on a dot opens its agent, by its phase and index. */
export function Strip({
  phases,
  className,
  onOpen,
}: {
  phases: StripPhase[]
  className?: string
  onOpen?: (agent: { phase: number; index: number }) => void
}) {
  return (
    <div
      data-slot="crew-strip"
      className={cn(
        "flex h-5 min-w-0 items-center gap-2.5 overflow-hidden text-meta whitespace-nowrap",
        className
      )}
    >
      {phases.map((phase, at) => (
        <div
          key={phase.index}
          data-when={phase.when}
          className={cn(
            "flex items-center gap-2",
            phase.bar ? "min-w-0 shrink" : "shrink-0"
          )}
        >
          {at > 0 && (
            <span aria-hidden className="h-px w-3.5 shrink-0 bg-sub-rule" />
          )}
          <span
            className={cn(
              "flex shrink-0 items-center gap-0.75",
              phase.when === "current"
                ? "font-medium text-foreground"
                : phase.when === "future"
                  ? "text-sub-faint"
                  : "text-muted-foreground"
            )}
          >
            {phase.done && phase.when === "past" && (
              <CheckIcon aria-label="done" className="size-3 opacity-80" />
            )}
            {phase.title}
            {phase.count && !phase.bar && (
              <span className="font-normal text-muted-foreground tabular-nums">
                {" "}
                {phase.count}
              </span>
            )}
          </span>
          {phase.bar ? (
            <>
              <span
                title={phase.tip}
                className="flex h-1 min-w-11 flex-[0_1_104px] gap-px overflow-hidden rounded-full bg-foreground/9"
              >
                {phase.bar.map((share) => (
                  <i
                    key={share.look}
                    data-sat={share.look}
                    className="block min-w-px"
                    style={{
                      flexGrow: share.n,
                      background:
                        share.look === "queued"
                          ? "transparent"
                          : SATELLITE_COLOURS[share.look],
                    }}
                  />
                ))}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {phase.count}
              </span>
            </>
          ) : (
            phase.dots.length > 0 && (
              <span className="flex items-center gap-0.75">
                {phase.dots.map((dot) => (
                  <button
                    key={dot.key}
                    type="button"
                    title={dot.tip}
                    aria-label={dot.tip}
                    disabled={!onOpen}
                    onClick={() => onOpen?.(dot)}
                    className="flex cursor-pointer rounded-full outline-none hover:brightness-135 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default"
                  >
                    <Satellite state={dot.look} size={8} label={dot.tip} />
                  </button>
                ))}
              </span>
            )
          )}
        </div>
      ))}
    </div>
  )
}
