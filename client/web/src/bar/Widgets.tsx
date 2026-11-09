import type { Problem } from "@banda/contract/look"
import type { WidgetProps } from "@banda/ui/module"
import { type ReactNode, useMemo } from "react"
import { useLookBar, useLookSettings } from "../look"
import { runs, widgets } from "../registry"
import type { Layout } from "./arrange"
import { type Known, PARTS, type Part, placed } from "./placed"

/** A widget the bar draws, by its id. */
export type Drawn = { id: string; node: ReactNode }

/**
 * The widgets of each part of the bar, drawn, as the look's `[bar]` lists
 * them, and a Problem for each id the window has no widget for. A
 * module's widget shows only while the engine runs its module (ADR 0022,
 * decision 5); the window's own, the counts and the Tiling's, always.
 * Each is given the same, and reads where the Person is from Here. With
 * them, `[bar]`'s lists, for a widget moved with Alt to write (ADR 0064).
 */
export function useWidgets(
  running: readonly string[],
  { engine, projects }: WidgetProps
): { parts: Record<Part, Drawn[]>; listed: Layout; problems: Problem[] } {
  const bar = useLookBar()
  const settings = useLookSettings()["look.toml"]
  const { parts, problems } = useMemo(() => {
    const known = (id: string): Known => {
      const theirs = widgets.get(id)
      if (!theirs) return undefined
      return runs(theirs.module, running) ? "shown" : "off"
    }
    return placed(bar, known, settings)
  }, [bar, running, settings])
  const drawn = {} as Record<Part, Drawn[]>
  for (const part of PARTS) {
    drawn[part] = parts[part].map((id) => {
      const { Widget } = widgets.get(id)!.widget
      return { id, node: <Widget engine={engine} projects={projects} /> }
    })
  }
  const listed = useMemo(
    () => ({ left: bar.left, center: bar.center, right: bar.right }),
    [bar]
  )
  return { parts: drawn, listed, problems }
}
