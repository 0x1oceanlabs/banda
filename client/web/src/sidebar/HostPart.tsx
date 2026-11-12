/**
 * Another machine's label in the sidebar list (ADR 0081, decision 4),
 * where the list is grouped by Project, and this machine's where the
 * Person asked it named too; beside `MachineCard`, the card its name
 * opens. What a machine's state is the foot's machines say, and its
 * cards (ADR 0098, decision 18).
 */
import { useOpenUpdates } from "../bar/update/heard"
import { type ReactNode, useContext } from "react"
import type { Named } from "@banda/contract/machines"
import { MachineMark } from "@banda/ui/components/machine-icon"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { HostsContext, otherBuild, type Shown, useRun } from "@banda/core/react"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  EllipsisIcon,
  PlayIcon,
  PowerIcon,
  SettingsIcon,
} from "lucide-react"
import { MachineCard } from "./MachineCard"

/**
 * Another host of `hosts.toml` (ADR 0081, decision 4): its quiet label,
 * its icon and the name it says it has (ADR 0095, decision 6), Start
 * while it is stopped, its other build, which opens its updates (ADR
 * 0115), and what it holds below, unless the Person folded it. Its ⋯ folds it, opens the settings, and stops Banda there while
 * Banda answers there, by the Window's actions. Short of room, a long
 * name gives way.
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
  const openUpdates = useOpenUpdates()
  const run = useRun()
  const other = otherBuild(host.state)
  const { name } = host.named
  return (
    <div role="group" aria-label={name} className="flex flex-col">
      {/* The name takes what it needs, and gives way first; Start and ⋯
          never give way. */}
      <div className="group/label relative flex min-h-8 items-center gap-1.5 px-2 pt-3.5 pb-0.5 text-meta whitespace-nowrap text-muted-foreground">
        <h3 className="mr-auto flex min-w-0">
          <MachineCard host={host.name}>
            <MachineMark named={host.named} form="full" className="shrink" />
          </MachineCard>
        </h3>
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
        <button
          type="button"
          className="self-start px-2 pb-1 text-left text-meta text-muted-foreground tabular-nums hover:text-foreground"
          title={`${name} runs another build of Banda than this window: its updates`}
          onClick={() => openUpdates(host.name)}
        >
          {other}
        </button>
      )}
      {children && !folded && (
        <div className="flex flex-col gap-1">{children}</div>
      )}
    </div>
  )
}

/**
 * This machine's Projects, under a label where the Person asked it named
 * as the others are (ADR 0095, decision 4), grouped by Project or in the
 * list of Projects: its full form, and no state, as it is always here.
 */
export function HerePart({
  named,
  children,
}: {
  named: Named
  children: ReactNode
}) {
  return (
    <div role="group" aria-label={named.name} className="flex flex-col">
      <div className="flex min-h-8 items-center px-2 pt-3.5 pb-0.5 text-meta whitespace-nowrap text-muted-foreground">
        <h3 className="flex min-w-0">
          <MachineMark named={named} form="full" className="shrink" />
        </h3>
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}

/** A stopped host's Start: it starts Banda there, on its label and in
 * the foot's machines. */
export function StartThere({ host }: { host: Shown }) {
  const kept = useContext(HostsContext)
  return (
    <Button
      variant="ghost"
      size="xs"
      // Its own inset is room enough from what stands before it.
      className="-my-1 -mr-1.5 -ml-1 shrink-0"
      onClick={() => kept.start(host.name)}
    >
      <PlayIcon />
      Start
    </Button>
  )
}
