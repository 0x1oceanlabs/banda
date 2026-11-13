/**
 * What the window draws of a Project's trust (ADR 0083, decision 5): the
 * list of what waits for it, the card that trusts a Project later, from
 * its menu or its settings, and the "soon" of what is not built yet.
 */
import { useCallback, useEffect, useState } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
} from "@banda/ui/components/popover"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { useAct } from "@banda/ui/hooks/use-act"
import { useRead } from "@banda/ui/hooks/use-read"
import { useFence } from "@banda/ui/hooks/use-status"
import { trustProject } from "@banda/ui/lib/projects"
import { cn } from "@banda/ui/lib/utils"
import { FolderIcon, GitBranchIcon, PlugIcon } from "lucide-react"
import { useHoldWhile } from "../sidebar"
import {
  askedOf,
  GITHUB_AND_SSH,
  givenBySaying,
  NOTHING_YET,
  UNSEEN,
  type Waiting,
} from "./trust"

/** What is not built yet, beside its greyed control (ADR 0084). */
export function Soon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full bg-foreground/8 px-1.5 text-small leading-4 font-normal text-muted-foreground",
        className
      )}
    >
      soon
    </span>
  )
}

/** What a folder holds that its Harnesses load only once it is trusted,
 * a row each, quietly; or that nothing does yet. */
export function Waits({ waits }: { waits: readonly Waiting[] }) {
  if (waits.length === 0)
    return <p className="text-meta text-muted-foreground">{NOTHING_YET}</p>
  return (
    <ul
      aria-label="What waits"
      className="flex flex-col rounded-control py-1 ring-1 ring-border ring-inset"
    >
      {waits.map(({ name, holds, kind }) => {
        const Icon = kind === "file" ? PlugIcon : FolderIcon
        return (
          <li
            key={name}
            className="flex min-w-0 items-center gap-2 px-2.5 py-0.5 text-meta"
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <code className="shrink-0 font-mono">{name}</code>
            <span className="ml-auto min-w-0 truncate text-muted-foreground">
              {holds}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** That trusting a Project gives its Agents the Person's GitHub token and
 * ssh-agent (ADR 0083), under what else waits for it. */
function TokenLine() {
  return (
    <p className="flex items-center gap-2 text-meta text-muted-foreground">
      <GitBranchIcon className="size-3.5 shrink-0" />
      {GITHUB_AND_SSH}
    </p>
  )
}

/** A Project to trust, and what the card stands by. */
export type Trusting = { project: ProjectId; anchor: Element }

/** The attribute a Project's card in the sidebar carries, its id (ADR
 * 0098, decision 16): the trust card stands by it. */
export const PROJECT_CARD = "data-project-card"

/** What `askTrust` sends a Project's card, for the sidebar's trust card
 * to hear: a Window's own, as its page is. */
const ASKED = "banda:trust"

/**
 * Asks on a card whether to trust `project` (ADR 0083, decision 5), by
 * its card in the sidebar; whether that card is drawn and its sidebar
 * heard, as one folded away or in another tab is not, and asks nothing.
 */
export function askTrust(project: ProjectId): boolean {
  const card = document.querySelector(
    `[${PROJECT_CARD}="${CSS.escape(project)}"]`
  )
  const asked = new Event(ASKED, { bubbles: true, cancelable: true })
  card?.dispatchEvent(asked)
  return asked.defaultPrevented
}

/** The card `askTrust` opened, by the sidebar's Projects: it closes as
 * it trusts, or as the Person cancels. */
export function AskedTrust({
  engine,
  projects,
}: {
  engine: Engine
  projects: readonly ProjectSummary[]
}) {
  const [target, setTarget] = useState<Trusting>()
  useEffect(() => {
    const ask = (event: Event) => {
      const anchor = event.target
      const project =
        anchor instanceof Element ? anchor.getAttribute(PROJECT_CARD) : null
      if (!(anchor instanceof Element) || !project) return
      event.preventDefault()
      setTarget({ project: project as ProjectId, anchor })
    }
    document.addEventListener(ASKED, ask)
    return () => document.removeEventListener(ASKED, ask)
  }, [])
  return (
    <TrustCard
      engine={engine}
      projects={projects}
      target={target}
      onClose={() => setTarget(undefined)}
    />
  )
}

/**
 * The card that trusts a Project after it was added: what its Harnesses
 * will load, that its Agents get the Person's GitHub token and ssh-agent,
 * and Trust. A Project trusted only as nothing marked it foreign is said to
 * be trusted here, and the card names it by what that does: it gives its
 * Agents both, or the ssh-agent alone where the fence does not hold. Only
 * this click trusts it; Cancel, Esc or a click elsewhere leaves it as it
 * is.
 */
export function TrustCard({
  engine,
  projects,
  target,
  align = "start",
  onClose,
}: {
  engine: Engine
  projects: readonly ProjectSummary[]
  target: Trusting | undefined
  /** Which of the anchor's edges it lines up with: a row's start, or a
   * button's end at the right of a Pane. */
  align?: "start" | "end"
  onClose: () => void
}) {
  const project = projects.find((one) => one.id === target?.project)
  const shown = target !== undefined && project !== undefined
  // Anchored at a row of the sidebar list, it holds the list still while
  // open (ADR 0098, decision 6); in Settings, nothing.
  useHoldWhile(shown)
  return (
    <Popover open={shown} onOpenChange={(open) => !open && onClose()}>
      {target && project && (
        <PopoverContent
          anchor={target.anchor}
          align={align}
          sideOffset={6}
          className="w-88 gap-2"
        >
          <Card
            key={project.id}
            engine={engine}
            project={project}
            onClose={onClose}
          />
        </PopoverContent>
      )}
    </Popover>
  )
}

function Card({
  engine,
  project,
  onClose,
}: {
  engine: Engine
  project: ProjectSummary
  onClose: () => void
}) {
  // What it names now, as Add Project would find it.
  const read = useRead(
    useCallback(
      () => engine.call("projects.foreign", { folder: project.folder }),
      [engine, project.folder]
    )
  )
  const { busy, problem, act } = useAct()
  const given = givenBySaying(useFence(engine)?.fence === "holds")
  const trust = async () => {
    if (await act(() => trustProject(engine, project.id, true))) onClose()
  }
  return (
    <>
      <div className="flex items-center gap-2">
        <ProjectSign project={project} />
        <PopoverTitle className="min-w-0 break-words">
          {project.trusted
            ? `Give ${project.name}'s Agents ${given}?`
            : `Trust ${project.name}?`}
        </PopoverTitle>
      </div>
      {project.trusted ? (
        <PopoverDescription>
          Say you trust it, and its Agents get {given} from their next turn.
        </PopoverDescription>
      ) : (
        <>
          <PopoverDescription>
            Claude Code and Codex will load what it names, from their next turn:
          </PopoverDescription>
          {read.state === "ready" && (
            <Waits waits={askedOf(read.value).waits} />
          )}
          {read.state === "refused" && (
            <p className="text-meta text-muted-foreground">
              {UNSEEN} {read.refusal.message}
            </p>
          )}
          <TokenLine />
        </>
      )}
      {problem && (
        <p role="alert" className="text-meta text-destructive">
          {problem}
        </p>
      )}
      <div className="mt-1 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void trust()}>
          Trust
        </Button>
      </div>
    </>
  )
}
