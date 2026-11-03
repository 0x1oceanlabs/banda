import type { SpaceId } from "@banda/contract"
import type { Problem } from "@banda/contract/look"
import type { Aside } from "@banda/contract/workspaces"
import type { WidgetProps } from "@banda/ui/module"
import type { Lists, PaneState } from "@banda/ui/pane"
import { type ComponentType, type ReactNode, useMemo } from "react"
import { useLookBar, useLookSettings } from "../look"
import { runs, widgets } from "../registry"
import { AsidePill } from "../safe/AsidePill"
import { Counts } from "./Counts"
import { type Known, PARTS, type Part, placed } from "./placed"

/** What the window's own widgets are given besides a module's, as the
 * window's own actions are (`Action<Context>`). */
export type OwnProps = WidgetProps & {
  /** What every module lists now, as the sidebar shows it. */
  lists: Lists
  /** Whether the sidebar shows. */
  sidebarShown: boolean
  /** Opens a Pane as a row of the sidebar does. */
  onOpen: (space: SpaceId, pane: PaneState) => void
  /** The workspaces set aside, while they are (ADR 0039, decision 2). */
  aside: Aside | null
}

/** The window's own widgets, by id, which stand on the bar as a module's
 * do. */
const OWN: Readonly<Record<string, ComponentType<OwnProps>>> = {
  "sidebar.counts": Counts,
  "workspaces.aside": ({ engine, aside }) =>
    aside && <AsidePill engine={engine} aside={aside} />,
}

/**
 * The widgets of each part of the bar, drawn, as the look's `[bar]` lists
 * them, and a Problem for each id the window has no widget for. A
 * module's widget shows only while the engine runs its module (ADR 0022,
 * decision 5).
 */
export function useWidgets(
  running: readonly string[],
  props: OwnProps
): { parts: Record<Part, ReactNode>; problems: Problem[] } {
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
  const drawn = {} as Record<Part, ReactNode>
  for (const part of PARTS) {
    drawn[part] = parts[part].map((id) => {
      // A module's widget takes what it knows of the window's own props.
      const Widget = Object.hasOwn(OWN, id)
        ? OWN[id]!
        : widgets.get(id)!.widget.Widget
      return <Widget key={id} {...props} />
    })
  }
  return { parts: drawn, problems }
}
