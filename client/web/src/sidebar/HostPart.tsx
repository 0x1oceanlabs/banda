/**
 * Another machine's place in the sidebar list (ADR 0081, decision 4): its
 * label, what the label says of its state, and its lines in the list of
 * Projects; beside `MachineCard`, the card its name opens.
 */
import { type ReactNode, useContext } from "react"
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
  awayFor,
  HostsContext,
  otherBuild,
  type Shown,
  useRun,
} from "@banda/core/react"
import { cn } from "@banda/ui/lib/utils"
import { useNow } from "@banda/ui/hooks/use-now"
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
 * Person folded it. Away, what it holds dims. Its ⋯ folds it, opens the
 * settings, and stops Banda there while Banda answers there, by the
 * Window's actions.
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
      <div className="group/label relative flex min-h-8 items-center gap-1.5 px-2 pt-3.5 pb-0.5 text-xs whitespace-nowrap text-muted-foreground">
        <h3 className="flex min-w-0">
          <MachineCard host={host.name}>
            <MachineMark named={host.named} form="full" />
          </MachineCard>
        </h3>
        <span className="ml-auto flex min-w-0 items-center gap-1.5 tabular-nums">
          <HostWords host={host} />
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${name} menu`}
                title={name}
                // Out of sight until the pointer is over the label, and
                // still reached by Tab, which shows it.
                className="sr-only -my-1 -mr-1.5 group-hover/label:not-sr-only focus-visible:not-sr-only data-popup-open:not-sr-only pointer-coarse:not-sr-only"
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-48">
            {/* A label with nothing under it, as the Inbox's or a
                stopped machine's, has nothing to fold. */}
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
            host.state.state === "away" && "opacity-45"
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** What a host's label says of its state: nothing when live, and only
 * the window's own words; stopped, its Start starts Banda there. */
function HostWords({ host }: { host: Shown }) {
  const kept = useContext(HostsContext)
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
      return <Away since={host.away} why={state.why} />
    case "stopped":
      return (
        <>
          <span>stopped</span>
          <Button
            variant="ghost"
            size="xs"
            className="-my-1 -mr-1.5"
            onClick={() => kept.start(host.name)}
          >
            <PlayIcon />
            Start
          </Button>
        </>
      )
    case "refused":
      return (
        <span className="min-w-0 truncate" title={state.why}>
          {state.why}
        </span>
      )
  }
}

/** How long a host has been away, by the label's own rule (`awayFor`). */
function Away({ since, why }: { since?: number; why: string }) {
  const away = awayFor(since, useNow(15_000))
  return <span title={why}>{away ? `away · ${away}` : "away"}</span>
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
      className="flex min-w-0 items-center gap-2 rounded-control border border-transparent px-2 py-1 text-sm"
    >
      <ProjectSign project={project} />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      {settings.projects.rollup && <Rollup mark={mark} waiting={waiting} />}
    </div>
  ))
}
