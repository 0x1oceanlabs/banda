/**
 * ✎, the sidebar header's New Thread (ADR 0098, decision 19): a click
 * starts a Thread at once, in the Project whose rows alone the list
 * shows, else where Alt+Enter starts one (`Here.starts`, ADR 0102), on
 * the machine that has that Project, with its default Harness. A right
 * click, a press held, `↓` or `Shift+F10` opens its menu instead, which
 * starts one elsewhere: in another Project, on another machine or with
 * another Harness, at once as one is picked. A tick marks what a click
 * takes. Add Project… and Projects… are there too (decision 16). What it
 * starts goes by the Window's actions, as their keys would (`useOpen`).
 */
import { useContext, useEffect, useRef, useState } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import type { HarnessView } from "@banda/contract/harnesses"
import type { Named } from "@banda/contract/machines"
import {
  type Here,
  HostsContext,
  type Machine,
  useHere,
  useHereNamed,
  useMachines,
} from "@banda/core/react"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@banda/ui/components/dropdown-menu"
import { Emblem } from "@banda/ui/components/emblem"
import { MachineMark } from "@banda/ui/components/machine-icon"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { useHarnesses } from "@banda/ui/hooks/use-harnesses"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { useStartsOn } from "@banda/ui/hooks/use-starts-on"
import { isMac } from "@banda/ui/lib/keys"
import { NO_PROJECT } from "@banda/ui/lib/projects"
import {
  CheckIcon,
  FolderPlusIcon,
  FoldersIcon,
  SquarePenIcon,
} from "lucide-react"
import {
  clickOf,
  NEW_THREAD,
  type NewThread,
  newThread,
  useNewThread,
  useOpen,
} from "./open"

/** How long a press on ✎ is held before its menu opens, as a right click
 * opens it. */
const HOLD = 500

/** Where a new Thread starts: a Project, or a machine's No Project, on
 * the machine that has it, by its key in `hosts.toml`; none for this
 * machine. One whose folder is missing is found first. */
export type Start = { project: ProjectId; host?: string; missing?: boolean }

/**
 * Where a click on ✎ starts a Thread, as the menu ticks it: what a click
 * starts (`clickOf`), on the machine that lists that Project, this one
 * first, as `Hosts.hostOf` finds it. A Project no pick
 * offers, as one whose folder is missing, has no machine and no tick.
 */
export function startOf(
  { project, missing }: NewThread,
  machines: readonly Machine[] | undefined
): Start {
  for (const { host, machine, projects } of machines ?? [])
    if (machine === project || projects.some((one) => one.id === project))
      return { project, host }
  return { project, ...(missing && { missing }) }
}

/** One pick of "in": a Project, or a machine's No Project, which has no
 * summary. */
export type InPick = {
  start: Start
  name: string
  project?: ProjectSummary
  ticked: boolean
}

/** A machine's part of "in": its name and icon, none for this machine,
 * whether it is away, and its picks. */
export type InPart = {
  host?: string
  named?: Named
  away: boolean
  picks: InPick[]
}

/**
 * The menu's "in", grouped by machine as a new Thread's Project picker
 * groups them (ADR 0095, decision 7): this machine first, then each other
 * one the Window shows. Each machine's Projects, pinned first, then its
 * No Project, the group the sidebar draws last, once its engine named
 * it. A machine with nothing to start in has no part.
 */
export function inParts(machines: readonly Machine[], start: Start): InPart[] {
  const ticked = (at: Start) =>
    at.project === start.project && at.host === start.host
  return machines
    .map(({ host, named, machine, state, projects }) => {
      const picks: InPick[] = projects.map((project) => {
        const at = { project: project.id, host }
        return { start: at, name: project.name, project, ticked: ticked(at) }
      })
      if (machine !== undefined) {
        const at = { project: machine, host }
        picks.push({ start: at, name: NO_PROJECT, ticked: ticked(at) })
      }
      return { host, named, away: state === "away", picks }
    })
    .filter((part) => part.picks.length > 0)
}

/** A machine of "on", and where a pick of it starts: none until its
 * engine named its No Project. */
export type OnPick = {
  host?: string
  named?: Named
  away: boolean
  start?: Start
  ticked: boolean
}

/**
 * The menu's "on": the machines a new Thread starts on. The one a click
 * takes starts where the click does; another starts in its No Project,
 * as no Project is on two machines. With one machine there is none: one
 * machine is not named anywhere (ADR 0095, decision 4).
 */
export function onPicks(machines: readonly Machine[], start: Start): OnPick[] {
  if (machines.length < 2) return []
  return machines.map(({ host, named, machine, state }) => {
    const ticked = host === start.host
    const there = machine === undefined ? undefined : { project: machine, host }
    return {
      host,
      named,
      away: state === "away",
      start: ticked ? start : there,
      ticked,
    }
  })
}

/**
 * The menu's "with": the Harnesses on, in the order their list names
 * them, and the one a click takes: `starts`, as `useStartsOn` says
 * a new Thread starts there (ADR 0093, decision 7), else the first.
 */
export function withPicks(
  harnesses: readonly HarnessView[],
  starts?: string
): {
  on: HarnessView[]
  ticked?: string
} {
  const on = harnesses.filter((harness) => harness.enabled)
  const ticked = on.find((harness) => harness.id === starts) ?? on[0]
  return { on, ticked: ticked?.id }
}

/** Where a New Thread asked for in no Project starts: made once, so a
 * move of the focus within it draws the menu not. */
const startsOf = (here: Here) => here.starts

/** A tick, after what a click takes. */
const TICK = <CheckIcon aria-hidden className="ml-auto" />

/** ✎ and its menu. */
export function NewThreadMenu({
  engine,
  only,
  projects,
}: {
  /** This machine's engine. */
  engine: Engine
  /** The Project whose rows alone the list shows, if one: a click starts
   * there. */
  only?: ProjectId
  projects: readonly ProjectSummary[]
}) {
  const keyFor = useKeyLabel()
  // Read as ✎ is pressed: a move of the focus draws ✎ not.
  const startHere = useNewThread(only, projects)
  const [shown, setShown] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  // How the menu closed: a press elsewhere leaves the focus where it went.
  const reason = useRef<string>(undefined)
  // A press held opens the menu, and its click then starts nothing; nor
  // does one on ✎ while the menu is open, which closed it.
  const held = useRef<ReturnType<typeof setTimeout>>(undefined)
  const press = useRef(false)
  const letGo = () => clearTimeout(held.current)
  useEffect(() => () => clearTimeout(held.current), [])
  return (
    <>
      <Button
        ref={button}
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label="New Thread"
        aria-haspopup="menu"
        aria-expanded={shown}
        title={keyFor(NEW_THREAD, "New Thread")}
        // Heard on the way down, before the menu hears a press outside it
        // and closes: so `shown` is still what the press found.
        onPointerDownCapture={(event) => {
          // A right click, or Ctrl+click on a Mac, is the menu's.
          const menu = event.button !== 0 || (isMac && event.ctrlKey)
          press.current = menu || shown
          letGo()
          if (menu) return
          held.current = setTimeout(() => {
            press.current = true
            setShown(true)
          }, HOLD)
        }}
        onPointerUp={letGo}
        onPointerLeave={letGo}
        onPointerCancel={letGo}
        onClick={(event) => {
          const menu = press.current
          press.current = false
          // A click by the keys (detail 0) always starts one: a right
          // click, or a press let go off ✎, has no click of its own to
          // clear what it left.
          if (!menu || event.detail === 0) startHere()
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          letGo()
          setShown(true)
        }}
        // ↓, Shift+F10 and the Menu key open it as a right click does; held
        // back here, they send no right click of their own.
        onKeyDown={(event) => {
          const { key, shiftKey } = event
          if (
            key !== "ArrowDown" &&
            key !== "ContextMenu" &&
            !(key === "F10" && shiftKey)
          )
            return
          event.preventDefault()
          setShown(true)
        }}
      >
        <SquarePenIcon />
      </Button>
      <DropdownMenu
        open={shown}
        // As the Thread menu: what a pick opens takes the focus at once.
        modal={false}
        onOpenChange={(now, details) => {
          reason.current = details.reason
          setShown(now)
        }}
      >
        <DropdownMenuContent
          anchor={button}
          align="end"
          aria-label="New Thread"
          // As wide as the sidebar's list at least, so it covers the card
          // under the header edge to edge.
          className="w-auto max-w-80 min-w-[calc(var(--sidebar-width,16rem)-1rem)]"
          // Esc gives ✎ the focus back; a pick, to what it opened.
          finalFocus={() =>
            reason.current === "escape-key" ? (button.current ?? true) : false
          }
        >
          <Picks engine={engine} only={only} projects={projects} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

/** The menu's items, worked out only while it is open, as its popup is
 * there only then. */
function Picks({
  engine,
  only,
  projects,
}: {
  engine: Engine
  only?: ProjectId
  projects: readonly ProjectSummary[]
}) {
  const open = useOpen()
  const shortcut = useKeyLabel()(NEW_THREAD)
  const all = useMachines() ?? []
  const starts = useHere(startsOf)
  const start = startOf(clickOf(starts, only, projects), all)
  const parts = inParts(all, start)
  // This machine's Projects under "in"; each other's under its label.
  const mine = parts.find((part) => part.host === undefined)
  const others = parts.filter((part) => part.host !== undefined)
  const on = onPicks(all, start)
  const live = all.find((one) => one.host === start.host)?.state === "live"
  const item = (one: InPick) => (
    <DropdownMenuItem
      key={one.start.project}
      aria-current={one.ticked || undefined}
      onClick={() => newThread(open, one.start)}
    >
      <ProjectSign project={one.project} />
      <span className="min-w-0 truncate">{one.name}</span>
      {one.ticked && TICK}
    </DropdownMenuItem>
  )
  return (
    <>
      <DropdownMenuItem onClick={() => newThread(open, start)}>
        <SquarePenIcon />
        New Thread
        {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
      </DropdownMenuItem>
      <DropdownMenuGroup>
        <DropdownMenuLabel>in</DropdownMenuLabel>
        {mine?.picks.map(item)}
      </DropdownMenuGroup>
      {others.map((part) => (
        <DropdownMenuGroup key={part.host}>
          <DropdownMenuLabel className="flex items-center">
            {part.named && <MachineMark named={part.named} form="full" />}
            {part.away && <span className="ml-auto pl-4">away</span>}
          </DropdownMenuLabel>
          {part.picks.map(item)}
        </DropdownMenuGroup>
      ))}
      {on.length > 0 && <OnGroup on={on} />}
      {live && <WithGroup engine={engine} start={start} />}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => open("project.add")}>
        <FolderPlusIcon />
        Add Project…
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => open("settings.open", { link: "projects" })}
      >
        <FoldersIcon />
        Projects…
      </DropdownMenuItem>
    </>
  )
}

/** The menu's "on": each machine by its name and icon, this one by the
 * name its engine says it has (`useHereNamed`). */
function OnGroup({ on }: { on: OnPick[] }) {
  const open = useOpen()
  const named = useHereNamed() ?? THIS_MACHINE
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>on</DropdownMenuLabel>
      {on.map((one) => {
        const { start } = one
        return (
          <DropdownMenuItem
            key={one.host ?? ""}
            disabled={!start}
            aria-current={one.ticked || undefined}
            onClick={() => start && newThread(open, start)}
          >
            <MachineMark
              named={one.named ?? named}
              form="full"
              className="text-inherit"
            />
            {one.away && (
              <span className="ml-auto pl-4 text-xs text-muted-foreground">
                away
              </span>
            )}
            {one.ticked && TICK}
          </DropdownMenuItem>
        )
      })}
    </DropdownMenuGroup>
  )
}

/** This machine before its engine says its name. */
const THIS_MACHINE: Named = { name: "This machine", icon: "desktop" }

/** The menu's "with": the Harnesses of the machine a click starts on,
 * this one's by `engine`, read as the menu opens, each starting where a
 * click does. */
function WithGroup({ engine, start }: { engine: Engine; start: Start }) {
  const open = useOpen()
  const kept = useContext(HostsContext)
  const there = start.host === undefined ? engine : kept.engine(start.host)
  const { on, ticked } = withPicks(useHarnesses(there), useStartsOn(there)?.id)
  if (on.length === 0) return null
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>with</DropdownMenuLabel>
      {on.map((harness) => (
        <DropdownMenuItem
          key={harness.id}
          aria-current={harness.id === ticked || undefined}
          onClick={() => newThread(open, { ...start, harness: harness.id })}
        >
          <Emblem of={harness} named className="size-4" />
          {harness.id === ticked && TICK}
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  )
}
