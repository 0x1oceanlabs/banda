import type { ProjectId } from "@banda/contract"
import type { Problem } from "@banda/contract/look"
import type { WidgetProps } from "@banda/ui/module"
import type { PaneState } from "@banda/ui/pane"
import { type ComponentType, memo, type ReactNode, useMemo } from "react"
import { useLookBar, useLookSettings } from "../look"
import { runs, widgets } from "../registry"
import { type Ahead, Counts } from "../sidebar/Counts"
import type { Layout } from "./arrange"
import { type Known, PARTS, type Part, placed } from "./placed"

/** A widget the bar draws, by its id. */
export type Drawn = { id: string; node: ReactNode }

/** What the window's own widgets are given besides a module's, as the
 * window's own actions are (`Action<Context>`). What every module lists
 * they read from the Window's stores. */
export type OwnProps = WidgetProps & {
  /** Whether the sidebar shows. */
  sidebarShown: boolean
  /** The thing the Pane in focus shows, whose Thread, an Agent's, the
   * counts name while the sidebar is hidden (ADR 0065, decision 9). */
  ahead?: Ahead
  /** Opens a Pane as a row of the sidebar does. */
  onOpen: (project: ProjectId, pane: PaneState) => void
}

/** The window's own widgets, by id, which stand on the bar as a module's
 * do. Each is drawn again only as its own props change (ADR 0088,
 * decision 7), as a module's is. */
const OWN: Readonly<Record<string, ComponentType<OwnProps>>> = {
  "sidebar.counts": memo(Counts),
}

/**
 * The widgets of each part of the bar, drawn, as the look's `[bar]` lists
 * them, and a Problem for each id the window has no widget for. A
 * module's widget shows only while the engine runs its module (ADR 0022,
 * decision 5). With them, `[bar]`'s lists, for a widget moved with Alt to
 * write (ADR 0064).
 */
export function useWidgets(
  running: readonly string[],
  props: OwnProps
): { parts: Record<Part, Drawn[]>; listed: Layout; problems: Problem[] } {
  const bar = useLookBar()
  const settings = useLookSettings()["look.toml"]
  const { parts, problems } = useMemo(() => {
    const known = (id: string): Known => {
      if (Object.hasOwn(OWN, id)) return "shown"
      const theirs = widgets.get(id)
      if (!theirs) return undefined
      return runs(theirs.module, running) ? "shown" : "off"
    }
    return placed(bar, known, settings)
  }, [bar, running, settings])
  const drawn = {} as Record<Part, Drawn[]>
  const { engine, projects, window } = props
  for (const part of PARTS) {
    drawn[part] = parts[part].map((id) => {
      const Own = Object.hasOwn(OWN, id) ? OWN[id] : undefined
      if (Own) return { id, node: <Own {...props} /> }
      // A module's widget is given only what a module's is.
      const { Widget } = widgets.get(id)!.widget
      const node = (
        <Widget engine={engine} projects={projects} window={window} />
      )
      return { id, node }
    })
  }
  const listed = useMemo(
    () => ({ left: bar.left, center: bar.center, right: bar.right }),
    [bar]
  )
  return { parts: drawn, listed, problems }
}
