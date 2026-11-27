import type { Problem } from "@banda/contract/look"
import { tomlOf } from "@banda/contract/settings"
import { sameData, type Shown } from "@banda/core"
import { HostsContext, useHostsBy } from "@banda/core/react"
import type { WidgetMachine, WidgetProps } from "@banda/ui/module"
import { type ReactNode, useCallback, useContext, useMemo } from "react"
import { useLookBar, useLookSettings } from "../../look"
import { runs, widgets } from "../../registry"
import type { Layout } from "./arrange"
import { type Known, PARTS, type Part, placed } from "./placed"

/** A widget the bar draws, by its id. */
export type Drawn = { id: string; node: ReactNode }

/** The other machines the Window shows, live or away, as a widget is
 * given them but for their sessions. */
const shownOf = (hosts: readonly Shown[]): Omit<WidgetMachine, "engine">[] =>
  hosts.flatMap(({ name, named, state: { state }, asOf }) =>
    state === "live" || state === "away"
      ? [
          {
            name,
            named,
            away: state === "away",
            ...(state === "away" && asOf !== undefined && { asOf }),
          },
        ]
      : []
  )

/**
 * The widgets of each part of the bar, drawn, as the look's `[bar]` lists
 * them, and a Problem for each id the window has no widget for. A
 * module's widget shows only while the engine runs its module (ADR 0022,
 * decision 5); the window's own, the counts and the Tiling's, always.
 * Each is given the same, the other machines with their sessions too
 * (ADR 0120, decision 5), and reads where the Person is from Here. With
 * them, `[bar]`'s lists, for a widget moved with Alt to write (ADR 0064).
 */
export function useWidgets(
  running: readonly string[],
  { engine, projects }: Omit<WidgetProps, "machines">
): { parts: Record<Part, Drawn[]>; listed: Layout } {
  const bar = useLookBar()
  const settings = useLookSettings()["look.toml"]
  const { parts } = useMemo(() => {
    const known = (id: string): Known => {
      const theirs = widgets.get(id)
      if (!theirs) return undefined
      return runs(theirs.module, running) ? "shown" : "off"
    }
    return placed(bar, known, settings)
  }, [bar, running, settings])
  const hosts = useContext(HostsContext)
  const shown = useHostsBy(shownOf, sameData)
  const machines = useMemo(
    () => shown.map((one) => ({ ...one, engine: hosts.engine(one.name) })),
    [shown, hosts]
  )
  const drawn = {} as Record<Part, Drawn[]>
  for (const part of PARTS) {
    drawn[part] = parts[part].map((id) => {
      const { Widget } = widgets.get(id)!.widget
      return {
        id,
        node: (
          <Widget engine={engine} projects={projects} machines={machines} />
        ),
      }
    })
  }
  const listed = useMemo(
    () => ({ left: bar.left, center: bar.center, right: bar.right }),
    [bar]
  )
  return { parts: drawn, listed }
}

/** Each id `[bar]` names that no module has a widget for, as a Problem at
 * its line (`placed`), for the look's problems to say. */
export function useBarProblems(): Problem[] {
  const bar = useLookBar()
  const settings = useLookSettings()["look.toml"]
  return useMemo(
    () =>
      placed(bar, (id) => (widgets.has(id) ? "shown" : undefined), settings)
        .problems,
    [bar, settings]
  )
}

/**
 * What a widget moved with the mod writes (ADR 0064): the parts of `[bar]`
 * it changed, one after another, as they are one file. `write` is the
 * device's writing of a setting.
 */
export function useArrangeBar(
  listed: Layout,
  write: (file: string, key: string, value: string) => Promise<string[]>
): (after: Layout) => void {
  return useCallback(
    (after) => {
      const changed = PARTS.filter(
        (part) =>
          after[part].length !== listed[part].length ||
          after[part].some((id, i) => listed[part][i] !== id)
      )
      void changed.reduce(
        (before, part) =>
          before.then(() =>
            write("look.toml", `bar.${part}`, tomlOf([...after[part]])).then(
              (wrong) => {
                if (wrong.length > 0) console.warn(...wrong)
              }
            )
          ),
        Promise.resolve()
      )
    },
    [listed, write]
  )
}
