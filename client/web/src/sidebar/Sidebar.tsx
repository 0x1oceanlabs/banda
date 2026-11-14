import type { ReactNode } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { ScrollArea } from "@banda/ui/components/scroll-area"
import { type Shown, useHosts } from "@banda/core/react"
import { cn } from "@banda/ui/lib/utils"
import type { PaneState } from "@banda/ui/pane"
import { useLookSidebar } from "../look"
import { Dismiss } from "./open"
import { AskedTrust } from "../trust/TrustCard"
import { Foot } from "./Foot"
import { HostPart } from "./HostPart"
import { regionsOf } from "./regions"
import { DeleteDialog } from "./CardMenu"
import { ProjectRows } from "./ProjectMenu"
import { SectionView } from "./SectionView"
import { PickList, useSidebarKeys } from "./PickList"
import { ShowTab, Tabs } from "./Tabs"
import { useOrdered } from "./useOrdered"
import { ToldSomeday, useSidebarView } from "./useSidebarView"

/**
 * The sidebar, docked at the window's left edge (ADR 0005, decision 8):
 * the Person's inbox of their Agents' work (ADR 0098), its tabs at its
 * top, every Thread of every Project where it stands, arranged as
 * `sidebar.toml` says (ADR 0008). The modules list what each Project has;
 * the sidebar only arranges and draws it. Its view menu writes the keys
 * into the file, by the settings, and the new arrangement comes back
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
  const { scrollsIn, ...view } = useSidebarView()
  // The other machines of `hosts.toml`, below this one's (ADR 0081): each
  // host's state by its name.
  const hosts = useHosts()
  const ordering = useOrdered(projects, settings, view)
  const { ordered, now, list } = ordering
  // The aside, the keys' scope, goes to it alone, as the list's element.
  const { aside, ...keys } = useSidebarKeys(
    ordering,
    view,
    isCurrent,
    onDismiss
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
          engine={engine}
          now={now}
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
          ref={aside}
          onKeyDown={keys.onKeyDown}
          className={cn(
            // An area of the window: what changes in it lays out and paints
            // nothing outside it (ADR 0088, decision 8).
            "absolute inset-y-(--gap-outer) left-(--gap-outer) z-20 flex w-(--sidebar-width) max-w-[calc(100%-2*var(--gap-outer))] flex-col overflow-hidden rounded-tile border bg-panel shadow-panel [contain:layout_paint_style] *:transition-opacity",
            // Its panel stays, over the Strip; what is in it dims.
            hiding && "*:opacity-40",
            !over &&
              "sidebar-desk:inset-y-0 sidebar-desk:left-0 sidebar-desk:rounded-none sidebar-desk:border-0 sidebar-desk:bg-desk sidebar-desk:shadow-none"
          )}
        >
          <Tabs tabs={ordered.tabs} tab={view.tab} />
          {/* A Project's menu archives its Threads by their rows. */}
          <ProjectRows value={ordered.rows}>
            {/* Where more Threads are below, the list fades out at its foot
            instead of a line. */}
            <ScrollArea
              ref={scrollsIn}
              {...list}
              className="min-h-0 flex-1 data-overflow-y-end:mask-b-from-[calc(100%-1.5rem)]"
            >
              <div className="flex flex-col gap-1 px-1.5 pb-2">
                <PickList
                  tab={view.tab}
                  picking={keys.picking}
                  deleting={keys.deleting}
                >
                  {/* This machine's list, where inbox zero tells the view it
                  told of Someday. */}
                  <ToldSomeday value={view.told}>{drawn()}</ToldSomeday>
                  {/* Grouped by Project, each host's groups follow under its
                  label; grouped otherwise, its cards are among this
                  machine's, and the foot says how it stands. */}
                  {settings.group === "project" &&
                    hosts.map((host) => part(host, drawn(host.name)))}
                </PickList>
              </div>
            </ScrollArea>
            <Foot />
            <AskedTrust engine={engine} projects={projects} />
            <DeleteDialog deleting={keys.deleting} />
          </ProjectRows>
        </aside>
      </ShowTab>
    </Dismiss>
  )
}
