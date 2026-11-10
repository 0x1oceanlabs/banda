import { type ReactNode, useState } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { ScrollArea } from "@banda/ui/components/scroll-area"
import { toast } from "@banda/ui/components/sonner"
import { trustProject } from "@banda/ui/lib/projects"
import { type Shown, useHosts } from "@banda/core/react"
import { cn } from "@banda/ui/lib/utils"
import { problem } from "@banda/ui/lib/words"
import type { PaneState } from "@banda/ui/pane"
import type { Section } from "./arrange"
import { useLookSidebar } from "../look"
import { Dismiss } from "./open"
import { TrustCard, type Trusting } from "../trust/TrustCard"
import { Foot } from "./Foot"
import { Header } from "./Header"
import { HostLines, HostPart, saysSomething } from "./HostPart"
import { ProjectMenu, type WithMenu } from "./ProjectMenu"
import { ProjectsList } from "./ProjectsList"
import { SectionView } from "./SectionView"
import { useOrdered } from "./useOrdered"
import { useSidebarView } from "./useSidebarView"

/**
 * The sidebar, docked at the window's left edge (ADR 0005, decision 8):
 * every Thread of every Project, arranged as `sidebar.toml` says (ADR 0008).
 * The modules list what each Project has; the sidebar only arranges and
 * draws it. Its view menu writes the preset into the file, through the
 * desktop, and the new arrangement comes back with the look. What the
 * Person asks of it runs by the actions' ids (`useRun`, ADR 0087), as
 * their keys would: the Window hands it what it shows and how its area
 * stands, no verb.
 */
export function Sidebar({
  over,
  onDismiss,
  hiding,
  engine,
  projects,
  home,
  machine,
  isCurrent,
  strayed,
}: {
  /**
   * Shown over the Strip in a narrow window (ADR 0025, decision 10): a
   * panel whatever the look, gone once it has done its work, a Pane or
   * a menu opened, or on Esc in it.
   */
  over?: boolean
  onDismiss?: () => void
  /** Its edge is dragged past the narrowest: letting go hides it. */
  hiding?: boolean
  engine: Engine
  projects: ProjectSummary[]
  /** The Project a new Thread from the header starts in. */
  home: ProjectId
  /** This machine's No Project, where its section's New Thread starts;
   * none until the engine names it. */
  machine?: ProjectId
  /** Whether a Pane is the one that has the focus, by all its args, as
   * before; `Here.pane` says it by what it shows, which is #827's fix. */
  isCurrent: (project: ProjectId, pane: PaneState) => boolean
  /** The Threads that stand away from their Project's workspace, by what
   * their Panes show (ADR 0102, decision 6). */
  strayed: ReadonlySet<string>
}) {
  const settings = useLookSidebar()
  const { only, toggled, more, folded, pick, toggle, toggleMore, fold } =
    useSidebarView(settings.preset)
  // The other machines of `hosts.toml`, below this one's (ADR 0081): each
  // host's state by its name.
  const hosts = useHosts()
  const { arranged, updates, take, letGo } = useOrdered(projects, settings, {
    only,
    toggled,
  })
  // The Project whose trust a card by its row asks about (ADR 0083,
  // decision 5); taking it back needs no card, and says when it failed.
  const [trusting, setTrusting] = useState<Trusting>()
  const onTrust = (project: ProjectId, anchor: Element) =>
    setTrusting({ project, anchor })
  const onStopTrusting = (project: ProjectId) => {
    trustProject(engine, project, false).catch((error: unknown) =>
      toast.error(problem(error))
    )
  }
  // A Project's row, wherever it shows, has its right-click menu.
  const withMenu: WithMenu = (project, row) => (
    <ProjectMenu
      project={project}
      onTrust={onTrust}
      onStopTrusting={onStopTrusting}
    >
      {row}
    </ProjectMenu>
  )
  const drawn = (section: Section) => (
    <SectionView
      key={section.key}
      section={section}
      settings={settings}
      more={more.has(section.key)}
      isCurrent={isCurrent}
      strayed={strayed}
      onToggle={() => toggle(section.key)}
      onMore={() => toggleMore(section.key)}
      engine={engine}
      machine={machine}
      withMenu={withMenu}
    />
  )
  // Another host's label, with what it holds below it unless folded:
  // `held` only when it holds something, as there is nothing to fold else.
  const part = (host: Shown, held?: ReactNode) => (
    <HostPart
      key={host.name}
      host={host}
      folded={folded.has(host.name)}
      onFold={() => fold(host.name)}
    >
      {held}
    </HostPart>
  )
  const byProject = settings.group.by === "project"
  const nothing =
    arranged.sections.every((s) => s.rows.length === 0) &&
    arranged.shelves.every((s) => s.rows.length === 0)

  return (
    <Dismiss value={onDismiss}>
      <aside
        aria-label="Sidebar"
        onPointerEnter={take}
        onPointerLeave={letGo}
        onKeyDown={(event) => {
          // Not Esc in a menu it opened, drawn elsewhere in the page.
          if (
            event.key === "Escape" &&
            event.currentTarget.contains(event.target as Node)
          )
            onDismiss?.()
        }}
        className={cn(
          // An area of the window: what changes in it lays out and paints
          // nothing outside it (ADR 0088, decision 8).
          "absolute inset-y-(--gap-outer) left-(--gap-outer) z-20 flex w-(--sidebar-width) max-w-[calc(100%-2*var(--gap-outer))] flex-col overflow-hidden rounded-tile border bg-panel shadow-(--panel-shadow) [contain:layout_paint_style] *:transition-opacity",
          // Its panel stays, over the Strip; what is in it dims.
          hiding && "*:opacity-40",
          !over &&
            "sidebar-desk:inset-y-0 sidebar-desk:left-0 sidebar-desk:rounded-none sidebar-desk:border-0 sidebar-desk:bg-desk sidebar-desk:shadow-none"
        )}
      >
        <Header only={only} home={home} projects={projects} />
        {updates > 0 && (
          <button
            type="button"
            onClick={take}
            className="absolute top-11 left-1/2 z-10 -translate-x-1/2 rounded-full bg-primary px-2.5 py-0.5 text-xs text-primary-foreground shadow-md"
          >
            ↑ {updates} {updates === 1 ? "update" : "updates"}
          </button>
        )}
        {/* Where more Threads are below, the list fades out at its foot
          instead of a line. */}
        <ScrollArea className="min-h-0 flex-1 data-overflow-y-end:mask-b-from-[calc(100%-1.5rem)]">
          <div className="flex flex-col gap-1 px-1.5 pb-2">
            {arranged.projects && (
              <ProjectsList
                lines={arranged.projects.filter((line) => !line.host)}
                settings={settings}
                only={only}
                onPick={pick}
                withMenu={withMenu}
              >
                {hosts.map((host) => {
                  const lines = arranged.projects!.filter(
                    (line) => line.host === host.name
                  )
                  return part(
                    host,
                    lines.length > 0 && (
                      <HostLines lines={lines} settings={settings} />
                    )
                  )
                })}
              </ProjectsList>
            )}
            {nothing ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                No Threads yet
              </p>
            ) : (
              arranged.sections.filter((section) => !section.host).map(drawn)
            )}
            {/* Grouped by Project, each host's sections follow under its
              label; grouped otherwise, its rows are among this machine's,
              and its label shows only what is not as usual. */}
            {byProject
              ? hosts.map((host) => {
                  const held = arranged.sections.filter(
                    (section) => section.host === host.name
                  )
                  return part(
                    host,
                    !nothing && held.length > 0 && held.map(drawn)
                  )
                })
              : !arranged.projects &&
                hosts.filter(saysSomething).map((host) => part(host))}
          </div>
        </ScrollArea>
        {arranged.shelves.length > 0 && (
          <div className="max-h-[45%] overflow-y-auto px-1.5 py-1">
            {arranged.shelves.map(drawn)}
          </div>
        )}
        <Foot />
        <TrustCard
          engine={engine}
          projects={projects}
          target={trusting}
          onClose={() => setTrusting(undefined)}
        />
      </aside>
    </Dismiss>
  )
}
