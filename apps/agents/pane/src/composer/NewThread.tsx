/** Where a new Thread starts: its Project (ADR 0006), on this machine or
 * another the window reaches (ADR 0095, decision 7). Its Harness is
 * chosen with its model, in the model picker (ADR 0031, decision 6). */
import { NO_PROJECT } from "@banda/ui/lib/projects"
import { MachineMark } from "@banda/ui/components/machine-icon"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { useMemo } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { type Machine, useMachines } from "@banda/core/react"
import { useMachine, useSeenNamed } from "@banda/ui/hooks/use-status"
import { useProjects } from "@banda/ui/hooks/use-projects"
import { openProjects, shownProjects } from "@banda/ui/lib/projects"
import { FolderPlusIcon } from "lucide-react"
import { type Choice, type ChoiceGroup, Pick } from "../settings/ThreadSettings"
import type { ThreadArgs } from "../thread/session"

/** A machine's part of the picker: its No Project, once its Host scope's
 * ID is known, then its Projects. */
export type Group = {
  /** The machine's key in `hosts.toml`; none for this machine. */
  host?: string
  /** Its name and icon, for its label; none for this machine's, or the
   * Pane's own outside a Window, which have none. */
  named?: Machine["named"]
  away: boolean
  /** Its Host scope's ID, which its No Project is. */
  machine?: ProjectId
  projects: readonly ProjectSummary[]
}

/**
 * The picker's groups (ADR 0095, decision 7): the Window's `machines`,
 * this one first and each other under its label, as the sidebar shows
 * them, in the root's window and a popped-out Pane's alike; outside a
 * Window only `own`, the Pane's own engine's, on the machine its Pane is
 * on. A machine with nothing to start in has none.
 */
export function groupsOf(
  machines: readonly Machine[] | undefined,
  own: Group
): Group[] {
  if (!machines) return [own]
  // The Pane's own engine may have named its No Project first, unless
  // the Window shows that ID on a machine already: a pick of it would
  // open there.
  const shown = new Set(
    machines.flatMap(({ machine, projects }) => [
      ...(machine === undefined ? [] : [machine]),
      ...projects.map((project) => project.id),
    ])
  )
  const first =
    own.machine === undefined || shown.has(own.machine)
      ? undefined
      : own.machine
  return machines
    .map(({ host, named, machine, state, projects }) => ({
      host,
      named,
      away: state === "away",
      machine: machine ?? (host === own.host ? first : undefined),
      projects,
    }))
    .filter((group) => group.machine !== undefined || group.projects.length > 0)
}

/**
 * A new Thread's args as it moves to a Project on machine `there`, from
 * `args` on Harness `harness`: the folder its draft made goes; on another
 * machine its Harness and how that folder was made go too, as a Harness
 * of one machine may not be on another, which starts it on its own.
 */
export function movedArgs(
  args: ThreadArgs,
  harness: string,
  there: string | undefined
): ThreadArgs {
  const same = there === args.host
  return {
    ...args,
    scratch: undefined,
    scratchCommand: same ? args.scratchCommand : undefined,
    harness: same ? harness : "",
  }
}

/** A group's choices: its No Project, then its Projects. */
function choicesIn(group: Group): Choice[] {
  const projects = group.projects.map((project) => ({
    id: project.id,
    name: project.name,
    about: project.folder,
    mark: <ProjectSign project={project} />,
  }))
  if (group.machine === undefined) return projects
  const none = {
    id: group.machine,
    name: NO_PROJECT,
    about: "A new Thread with its own folder",
    mark: <ProjectSign project={undefined} />,
  }
  return [none, ...projects]
}

/**
 * The picker's menu: this machine's choices with no label, each other's
 * under its label, as quiet as the sidebar's, and away still one to pick,
 * as the Thread waits there to be sent; and the machine each starts on.
 */
function menuOf(groups: readonly Group[]): {
  unlabelled: Choice[]
  labelled: ChoiceGroup[]
  on: ReadonlyMap<string, string | undefined>
} {
  const unlabelled: Choice[] = []
  const labelled: ChoiceGroup[] = []
  const on = new Map<string, string | undefined>()
  for (const group of groups) {
    const choices = choicesIn(group)
    for (const one of choices) on.set(one.id, group.host)
    if (!group.named) unlabelled.push(...choices)
    else
      labelled.push({
        key: group.host ?? "",
        label: (
          <>
            <MachineMark named={group.named} form="full" />
            {group.away && <span className="ml-auto pl-4">away</span>}
          </>
        ),
        choices,
      })
  }
  return { unlabelled, labelled, on }
}

/**
 * The Project of a Thread not yet started, and the machine it starts on.
 * A Person changes it until the first message; after it, it is the
 * Thread's for good.
 */
export function NewThreadBar({
  engine,
  project,
  host,
  disabled,
  onProject,
  onAddProject,
}: {
  engine: Engine
  project: ProjectId
  /** The other machine its Pane is on, by its key; none for this one. */
  host: string | undefined
  disabled: boolean
  /** Moves it to `project`, on machine `host`, none for this one. */
  onProject: (project: ProjectId, host: string | undefined) => void
  /** Opens "Add Project" in the Banda menu (ADR 0026), from the Project list. */
  onAddProject?: () => void
}) {
  const projects = useShownProjects(engine)
  const said = useMachine(engine)
  const seen = useSeenNamed(host)
  const machines = useMachines()
  const groups = useMemo(
    () => groupsOf(machines, { host, away: false, machine: said, projects }),
    [machines, host, said, projects]
  )
  // Its own machine's part: while that machine is away, as the Window
  // kept it, so a Pane opened there meanwhile still says where it is.
  const mine = groups.find((group) => group.host === host)
  const machine = said ?? mine?.machine
  const picked =
    projects.find((one) => one.id === project) ??
    mine?.projects.find((one) => one.id === project)
  // Its own machine, where it is another: after the Project, on the
  // button, as the sidebar has it ("banda on arc").
  const named = mine?.named ?? seen
  const { unlabelled, labelled, on } = useMemo(() => menuOf(groups), [groups])
  return (
    // In meta words, its icon in line with the composer's text above it.
    <div className="flex min-w-0 items-center gap-0.5 px-2.5 text-muted-foreground">
      {machine && (
        <Pick
          what="Project"
          icon={<ProjectSign project={picked} size={14} />}
          value={picked ? project : machine}
          choices={unlabelled}
          groups={labelled}
          after={
            named && {
              // Its whole name on hover, where a long one is cut.
              mark: (
                <MachineMark named={named} form="compact" title={named.name} />
              ),
              words: `on ${named.name}`,
            }
          }
          disabled={disabled}
          onChange={(id) => onProject(id as ProjectId, on.get(id))}
          more={
            onAddProject && {
              title: "Add Project",
              icon: <FolderPlusIcon />,
              run: onAddProject,
            }
          }
        />
      )}
    </div>
  )
}

function useShownProjects(engine: Engine): ProjectSummary[] {
  const { listed } = useProjects(engine)
  // As the window lists them: pinned first, archived ones not at all;
  // nor one whose folder is missing, where no Thread starts.
  return useMemo(
    () =>
      listed.state === "ready"
        ? openProjects(shownProjects(listed.value))
        : NONE,
    [listed]
  )
}

const NONE: ProjectSummary[] = []
