/**
 * The Projects section (ADR 0026, decision 5), in T3 Code's words: a
 * Project's name, whether it comes first, whether the Person trusts it
 * (ADR 0083, decision 5), whether it is hidden, and its removal. They are
 * the engine's, not a file's, so the section calls the engine, and tells
 * the window a Project changed: the engine of the machine picked under
 * "Settings for", whose Projects these are. Archived Projects show only
 * here, where they can come back.
 */
import { useState } from "react"
import type { ProjectSummary, UpdateProject } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@banda/ui/components/select"
import { Spinner } from "@banda/ui/components/spinner"
import { Switch } from "@banda/ui/components/switch"
import { useAct } from "@banda/ui/hooks/use-act"
import { useProjects } from "@banda/ui/hooks/use-projects"
import { useFence } from "@banda/ui/hooks/use-status"
import { ProjectSign } from "@banda/ui/components/project-sign"
import {
  findSign,
  removeProject,
  trustProject,
  updateProject,
} from "@banda/ui/lib/projects"
import { cn } from "@banda/ui/lib/utils"
import type { Runs } from "@banda/ui/pane"
import {
  BadgeCheckIcon,
  BoxIcon,
  CircleDashedIcon,
  FolderSearchIcon,
  Trash2Icon,
} from "lucide-react"
import { LOCATE } from "../menu/menu"
import { AsideRow } from "../safe/AsideRow"
import { RemoveProjectDialog, type Removing, removingOf } from "./RemoveProject"
import type { SectionProps } from "@banda/ui/settings"
import { Group, RowFrame, Rows } from "@banda/ui/components/setting-row"
import { Field } from "./SettingRow"
import { SignField, signAbout } from "./SignField"
import { notNow } from "../trust/not-now"
import { Soon, TrustCard, type Trusting } from "../trust/TrustCard"
import { ISOLATED, offersSaying, trustAbout } from "../trust/trust"

/** `engine`: of the machine whose Projects it shows; `lit`: the Project a
 * link names, `projects/<id>`. */
type Props = Pick<SectionProps, "engine" | "there" | "lit" | "run" | "runs">

/** The Projects, and the workspaces set aside while some are (ADR 0039):
 * those are this window's, so they show with this machine's Projects. */
export function ProjectsSettings(props: Props) {
  return (
    <>
      {props.there === undefined && <AsideRow engine={props.engine} />}
      <Project {...props} />
    </>
  )
}

function Project({ engine, lit, run, runs }: Props) {
  // Every Project, the archived too, as the window's other lists read them.
  const { listed } = useProjects(engine)
  // The Project picked here, until a link names another.
  const [pick, setPick] = useState<{ lit?: string; id: string }>()
  const picked = pick && pick.lit === lit ? pick.id : lit
  const { busy, problem, act } = useAct()
  const [removing, setRemoving] = useState<Removing>()
  // The Project whose trust a card by its button asks about.
  const [trusting, setTrusting] = useState<Trusting>()
  // Only trust the Person said gives a Project's Agents their ssh-agent,
  // and where the fence holds their GitHub token (ADR 0083).
  const fenced = useFence(engine)?.fence === "holds"

  if (listed.state === "loading") return <Spinner />
  if (listed.state === "refused")
    return <p className="text-ui text-destructive">{listed.refusal.message}</p>
  const projects = listed.value
  const project = projects.find((one) => one.id === picked) ?? projects[0]
  if (!project)
    return <p className="text-ui text-muted-foreground">No Projects yet.</p>

  // Trusted only as nothing marked it foreign, as a Project of the
  // Person's own folder is: saying so here gives its Agents the ssh-agent,
  // and the GitHub token where the fence holds (ADR 0083).
  const saying = offersSaying(project)
  const change = (how: Omit<UpdateProject, "project">) =>
    void act(() => updateProject(engine, { project: project.id, ...how }))
  // The Threads that go with it are the agents module's.
  const ask = async () => setRemoving(await removingOf(engine, project))
  // Locate picks the folder with this device's picker, which sees no
  // other machine's disk: the router says so, in its words.
  const locating = { project: project.id }
  const locate: Runs = runs?.("projects.locate", locating) ?? { runs: true }

  return (
    <>
      <div className="flex items-center gap-3">
        <span className="text-ui font-medium">Project</span>
        <Select
          value={project.id}
          onValueChange={(id) => setPick({ lit, id: id as string })}
        >
          <SelectTrigger aria-label="Project" className="min-w-48">
            <SelectValue>
              {(id: string) => nameOf(projects.find((one) => one.id === id))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {projects.map((one) => (
              <SelectItem key={one.id} value={one.id}>
                <ProjectSign project={one} size={14} />
                {nameOf(one)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span
          className={cn(
            "min-w-0 truncate font-mono text-meta text-muted-foreground",
            project.missing && "text-attention line-through"
          )}
          title={project.folder}
        >
          {project.folder}
        </span>
      </div>
      {problem && (
        <p role="alert" className="text-meta text-destructive">
          {problem}
        </p>
      )}
      <Rows>
        {project.missing && (
          <RowFrame
            dataKey="folder"
            title="Folder is missing"
            about="Its Threads open again once you locate the folder its work is in now."
          >
            {locate.runs ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => run?.("projects.locate", locating)}
              >
                <FolderSearchIcon />
                {LOCATE}
              </Button>
            ) : (
              <span className="text-meta text-muted-foreground">
                {locate.why}
              </span>
            )}
          </RowFrame>
        )}
        <RowFrame
          dataKey="name"
          title="Name"
          about="The Project's name in the sidebar and the Project pickers."
        >
          <Field
            label="Project name"
            value={project.name}
            onCommit={(name) => change({ name: name.trim() })}
          />
        </RowFrame>
        <RowFrame dataKey="sign" title="Sign" about={signAbout(project)}>
          <SignField
            key={project.id}
            project={project}
            busy={busy}
            onPick={(sign) => change({ sign })}
            onFindAgain={() => void act(() => findSign(engine, project.id))}
          />
        </RowFrame>
        <RowFrame
          dataKey="pin"
          title="Pin"
          about="Pinned Projects come first in Project pickers."
        >
          <Switch
            label="Pin Project"
            on={project.pinned}
            onChange={(pinned) => change({ pinned })}
          />
        </RowFrame>
        {!project.scratch && (
          <>
            <RowFrame
              dataKey="trust"
              title={
                <span className="flex items-center gap-1.5">
                  {project.trusted ? (
                    <BadgeCheckIcon className="size-3.5 text-muted-foreground" />
                  ) : (
                    <CircleDashedIcon className="size-3.5 text-muted-foreground" />
                  )}
                  Trust
                </span>
              }
              about={trustAbout(project, fenced)}
            >
              <span className="flex items-center gap-1.5">
                {(!project.trusted || saying) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={(event) =>
                      setTrusting({
                        project: project.id,
                        anchor: event.currentTarget,
                      })
                    }
                  >
                    {project.trusted ? "Say you trust it…" : "Trust…"}
                  </Button>
                )}
                {project.trusted && (
                  <Button
                    size="sm"
                    variant={saying ? "ghost" : "outline"}
                    disabled={busy}
                    // Taken back here, it asks nothing in the sidebar.
                    onClick={() => {
                      notNow(project.id)
                      void act(() => trustProject(engine, project.id, false))
                    }}
                  >
                    Stop trusting
                  </Button>
                )}
              </span>
            </RowFrame>
            <RowFrame
              dataKey="isolated"
              title={
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <BoxIcon className="size-3.5" />
                  {ISOLATED.setting}
                  <Soon />
                </span>
              }
              about={ISOLATED.settingAbout}
            >
              <Switch label={ISOLATED.setting} on={false} disabled />
            </RowFrame>
          </>
        )}
        <RowFrame
          dataKey="archive"
          title="Archive"
          about={
            project.archived
              ? "Hidden from Project pickers. Threads and files are kept."
              : "Hides the Project from Project pickers. Threads and files are kept."
          }
        >
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => change({ archived: !project.archived })}
          >
            {project.archived ? "Unarchive" : "Archive"}
          </Button>
        </RowFrame>
      </Rows>
      <Group title="Danger">
        <RowFrame
          dataKey="remove"
          title="Remove Project"
          about="Deletes the Project entry and its Threads. Files on disk are not touched."
        >
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void ask()}
          >
            <Trash2Icon />
            Remove Project
          </Button>
        </RowFrame>
      </Group>
      <TrustCard
        engine={engine}
        projects={projects}
        target={trusting}
        align="end"
        onClose={() => setTrusting(undefined)}
      />
      <RemoveProjectDialog
        removing={removing}
        onClose={() => setRemoving(undefined)}
        onRemove={(removed) => {
          setRemoving(undefined)
          void act(() => removeProject(engine, removed))
        }}
      />
    </>
  )
}

/** A Project's name in the picker; an archived one says so. */
function nameOf(project: ProjectSummary | undefined): string {
  if (!project) return ""
  return project.archived ? `${project.name} (archived)` : project.name
}
