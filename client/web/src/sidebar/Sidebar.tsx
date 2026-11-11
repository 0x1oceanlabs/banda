import { type ReactNode, useState } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { glanceAt } from "@banda/ui/components/banda-mark"
import { ScrollArea } from "@banda/ui/components/scroll-area"
import { toast } from "@banda/ui/components/sonner"
import { trustProject } from "@banda/ui/lib/projects"
import { type Shown, useHosts } from "@banda/core/react"
import { cn } from "@banda/ui/lib/utils"
import { problem } from "@banda/ui/lib/words"
import type { PaneState } from "@banda/ui/pane"
import { useLookSidebar } from "../look"
import { Dismiss } from "./open"
import { TrustCard, type Trusting } from "../trust/TrustCard"
import { Foot } from "./Foot"
import { Header } from "./Header"
import { HostLines, HostPart, saysSomething } from "./HostPart"
import { regionsOf } from "./regions"
import { ProjectMenu, type WithMenu } from "./ProjectMenu"
import { ProjectsList } from "./ProjectsList"
import { SectionView } from "./SectionView"
import { PANEL, ShowTab, tabId, tabKey, Tabs } from "./Tabs"
import { HoldingContext } from "./useHold"
import { useOrdered } from "./useOrdered"
import { ToldSomeday, useSidebarView } from "./useSidebarView"

/**
 * The sidebar, docked at the window's left edge (ADR 0005, decision 8):
 * the Person's inbox of their Agents' work (ADR 0098), its tabs under the
 * header, every Thread of every Project where it stands, arranged as
 * `sidebar.toml` says (ADR 0008). The modules list what each Project has;
 * the sidebar only arranges and draws it. Its view menu writes the preset
 * into the file, through the desktop, and the new arrangement comes back
 * with the look. What the Person asks of it runs by the actions' ids
 * (`useRun`, ADR 0087), as their keys would: the Window hands it what it
 * shows and how its area stands, no verb.
 */
export function Sidebar({
  over,
  onDismiss,
  hiding,
  engine,
  projects,
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
  // The element the list scrolls in goes to its ScrollArea alone: else
  // React's compiler reads the whole view as a ref.
  const { scrollsIn, ...view } = useSidebarView(settings.preset)
  // The other machines of `hosts.toml`, below this one's (ADR 0081): each
  // host's state by its name.
  const hosts = useHosts()
  const ordering = useOrdered(projects, settings, view, isCurrent)
  const { ordered, holds, list } = ordering
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
  const regions = regionsOf(ordered.blocks)
  // The regions of `host`, another machine, or this one's: grouped,
  // another machine's groups follow under its label.
  const drawn = (host?: string) => {
    const held = regions.filter((region) => region.host === host)
    return (
      held.length > 0 && (
        <SectionView
          regions={held}
          settings={settings}
          named={host !== undefined}
          isCurrent={isCurrent}
          strayed={strayed}
          onToggle={view.toggle}
          onMore={view.toggleMore}
          engine={engine}
          machine={machine}
          withMenu={withMenu}
          only={view.only}
          projects={projects}
          holds={holds}
        />
      )
    )
  }
  // Another host's label, with what it holds below it unless folded:
  // `held` only when it holds something, as there is nothing to fold else.
  const part = (host: Shown, held?: ReactNode) => (
    <HostPart
      key={host.name}
      host={host}
      folded={view.foldedHosts.has(host.name)}
      onFold={() => view.foldHost(host.name)}
    >
      {held}
    </HostPart>
  )

  return (
    <Dismiss value={onDismiss}>
      <ShowTab value={view.show}>
        <aside
          aria-label="Sidebar"
          data-sidebar=""
          onKeyDown={(event) => {
            // Not Esc in a menu it opened, drawn elsewhere in the page.
            const own = event.currentTarget.contains(event.target as Node)
            if (event.key === "Escape" && own) onDismiss?.()
            const tab = own ? tabKey(event.nativeEvent) : undefined
            if (tab) {
              event.preventDefault()
              view.show(tab)
            }
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
          <Header engine={engine} only={view.only} projects={projects} />
          <Tabs tabs={ordered.tabs} tab={view.tab} />
          {/* What is in the list holds it, and so does the trust card. */}
          <HoldingContext value={ordering.holder}>
            {/* Where more Threads are below, the list fades out at its foot
            instead of a line. */}
            <ScrollArea
              ref={scrollsIn}
              {...list}
              className="min-h-0 flex-1 data-overflow-y-end:mask-b-from-[calc(100%-1.5rem)]"
            >
              <div className="flex flex-col gap-1 px-1.5 pb-2">
                {ordered.projects && (
                  <ProjectsList
                    lines={ordered.projects.filter((line) => !line.host)}
                    settings={settings}
                    only={view.only}
                    onPick={view.pick}
                    withMenu={withMenu}
                  >
                    {hosts.map((host) => {
                      const lines = ordered.projects!.filter(
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
                <div
                  role="tabpanel"
                  id={PANEL}
                  aria-labelledby={tabId(view.tab)}
                  className="flex flex-col gap-1"
                  onPointerMove={(event) => glanceAt(event.nativeEvent)}
                  onPointerLeave={() => glanceAt(null)}
                >
                  {/* This machine's list, where inbox zero tells the view it
                  told of Someday. */}
                  <ToldSomeday value={view.told}>{drawn()}</ToldSomeday>
                  {/* Grouped by Project, each host's groups follow under its
                  label; grouped otherwise, its rows are among this machine's,
                  and its label shows only what is not as usual. */}
                  {settings.group.by === "project"
                    ? hosts.map((host) => part(host, drawn(host.name)))
                    : !ordered.projects &&
                      hosts.filter(saysSomething).map((host) => part(host))}
                </div>
              </div>
            </ScrollArea>
            <Foot />
            <TrustCard
              engine={engine}
              projects={projects}
              target={trusting}
              onClose={() => setTrusting(undefined)}
            />
          </HoldingContext>
        </aside>
      </ShowTab>
    </Dismiss>
  )
}
