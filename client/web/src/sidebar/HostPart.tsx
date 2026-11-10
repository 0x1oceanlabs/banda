/**
 * Another machine's place in the sidebar list (ADR 0081, decision 4): its
 * label, what the label says of its state, and its lines in the list of
 * Projects; beside `MachineCard`, the card its name opens.
 */
import { type ReactNode, useCallback, useContext } from "react"
import { MachineMark } from "@banda/ui/components/machine-icon"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import {
  asOfWords,
  HostsContext,
  notAnswered,
  otherBuild,
  type Shown,
  useNowOf,
  useRun,
} from "@banda/core/react"
import { cn } from "@banda/ui/lib/utils"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  EllipsisIcon,
  PlayIcon,
  PowerIcon,
  SettingsIcon,
} from "lucide-react"
import type { ProjectLine } from "./arrange"
import { MachineCard } from "./MachineCard"
import { Rollup } from "./Rollup"
import type { Settings } from "./settings"

/** Whether a host's label says something, where its rows are among this
 * machine's: all but a live host of this build. */
export function saysSomething(host: Shown): boolean {
  return host.state.state !== "live" || otherBuild(host.state) !== undefined
}

/**
 * Another host of `hosts.toml` (ADR 0081, decision 4): its quiet label,
 * its icon and the name it says it has (ADR 0095, decision 6), what is
 * not as usual in words on its right, and what it holds below, unless the
 * Person folded it. While the Window does not reach it, away or stopped,
 * what it holds dims, as it was last heard; the label does not. Its ⋯
 * folds it, opens the settings, and stops Banda there while Banda answers
 * there, by the Window's actions. Short of room, the words give way, then
 * a long name.
 */
export function HostPart({
  host,
  folded,
  onFold,
  children,
}: {
  host: Shown
  folded: boolean
  onFold: () => void
  children?: ReactNode
}) {
  const run = useRun()
  const other = otherBuild(host.state)
  const { name } = host.named
  return (
    <div role="group" aria-label={name} className="flex flex-col">
      {/* By columns, as each gives way in turn: the name takes what it
          needs first, up to most of the label; its words, on the right,
          what is left; Start and ⋯, each in its own column, never give
          way. Short of room, the words go first, then the name. */}
      <div className="group/label relative grid min-h-8 grid-flow-col grid-cols-[fit-content(60%)_minmax(0,1fr)] items-center gap-1.5 px-2 pt-3.5 pb-0.5 text-xs whitespace-nowrap text-muted-foreground">
        <h3 className="flex min-w-0">
          <MachineCard host={host.name}>
            <MachineMark named={host.named} form="full" className="shrink" />
          </MachineCard>
        </h3>
        <span className="flex min-w-0 items-center justify-end gap-1.5 tabular-nums">
          <HostWords host={host} />
        </span>
        {host.state.state === "stopped" && <StartThere host={host} />}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${name} menu`}
                title={name}
                // Out of sight until the pointer is over the label, and
                // still reached by Tab, which shows it. Shown, it takes
                // its place at once, as only its colours ease: Start
                // moves aside in one step, never sliding under it.
                className="sr-only transition-[color,background-color,border-color,box-shadow] group-hover/label:not-sr-only focus-visible:not-sr-only data-popup-open:not-sr-only pointer-coarse:not-sr-only"
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-48">
            {/* A label with nothing under it, as the Inbox's, has
                nothing to fold. */}
            {children && (
              <DropdownMenuItem onClick={onFold}>
                {folded ? <ChevronDownIcon /> : <ChevronUpIcon />}
                {folded ? `Unfold ${name}` : `Fold ${name}`}
              </DropdownMenuItem>
            )}
            {/* At the settings' top, until they have a Machines section
                (ADR 0095, plan step 5). */}
            <DropdownMenuItem onClick={() => run("settings.open")}>
              <SettingsIcon />
              Machine settings
            </DropdownMenuItem>
            {/* Only while Banda answers there: away, connecting or
                waiting for Tailscale sign-in, ssh would not reach it. */}
            {(host.state.state === "live" ||
              host.state.state === "refused") && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => run("hosts.stop", { name: host.name })}
                >
                  <PowerIcon />
                  Stop Banda on {name}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {other && !folded && (
        <p
          className="px-2 pb-1 text-xs text-muted-foreground tabular-nums"
          title={`${name} runs another build of Banda than this window`}
        >
          {other}
        </p>
      )}
      {children && !folded && (
        <div
          className={cn(
            "flex flex-col gap-1",
            host.away !== undefined && "opacity-45"
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** What a host's label says of its state: nothing when live, and only
 * the window's own words; away or stopped, what its rows are as of, once
 * here and on no row. */
function HostWords({ host }: { host: Shown }) {
  const { state } = host
  switch (state.state) {
    case "connecting":
      return <Dots />
    case "signin":
      // A link opens in the system's browser, as every link of the page.
      return (
        <a
          href={state.url}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-ring underline-offset-3 hover:underline"
        >
          Sign in to Tailscale
        </a>
      )
    case "live":
      return otherBuild(state) ? <span>other build</span> : null
    case "away":
      return <Away host={host} why={state.why} />
    case "stopped":
      return <AsOf state="stopped" host={host} />
    case "refused":
      return (
        <span className="min-w-0 truncate" title={state.why}>
          {state.why}
        </span>
      )
  }
}

/** A stopped host's Start: it starts Banda there. */
function StartThere({ host }: { host: Shown }) {
  const kept = useContext(HostsContext)
  return (
    <Button
      variant="ghost"
      size="xs"
      // Its own inset is room enough from the words before it.
      className="-my-1 -mr-1.5 -ml-1 shrink-0"
      onClick={() => kept.start(host.name)}
    >
      <PlayIcon />
      Start
    </Button>
  )
}

/** A host away, as of when it was last heard; its tooltip says why: the
 * link ended, or it has not answered since then (ADR 0082, decision 11). */
function Away({ host, why }: { host: Shown; why: string }) {
  // Said again only as the day turns, as a clock's words then change.
  const title = useNowOf(
    useCallback(
      (now: number) =>
        host.stale ? notAnswered(host.named, host.asOf, now) : why,
      [host, why]
    )
  )
  return <AsOf state="away" host={host} title={title} />
}

/** A state, and what a host's rows are as of, by the Window's one clock:
 * "away · as of 14:02", whole in its tooltip where it gives way. */
function AsOf({
  state,
  host,
  title,
}: {
  state: string
  host: Shown
  title?: string
}) {
  const words = useNowOf(
    useCallback(
      (now: number) =>
        [state, asOfWords(host, now)].filter(Boolean).join(" · "),
      [state, host]
    )
  )
  return (
    <span className="min-w-0 truncate" title={title ?? words}>
      {words}
    </span>
  )
}

/** Three faint dots: ssh still reaches the host. */
function Dots() {
  return (
    <span
      role="status"
      aria-label="Connecting"
      title="Connecting over ssh"
      className="inline-flex h-4 items-center gap-0.75"
    >
      {[0, 200, 400].map((delay) => (
        <i
          key={delay}
          className="size-0.75 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  )
}

/** Another host's lines in the list of Projects: shown, not picked yet. */
export function HostLines({
  lines,
  settings,
}: {
  lines: ProjectLine[]
  settings: Settings
}) {
  return lines.map(({ project, mark, waiting }) => (
    <div
      key={project.id}
      title={project.folder}
      className="flex min-w-0 items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-sm"
    >
      <ProjectSign project={project} />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      {settings.projects.rollup && <Rollup mark={mark} waiting={waiting} />}
    </div>
  ))
}
