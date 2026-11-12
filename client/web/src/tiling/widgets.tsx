/**
 * The Tiling's widgets on the Bar (ADR 0087, decision 5): the Pager, the
 * workspaces' cells, and the pill that says the workspaces are set aside. The Tiling is the
 * middle's program, and the Bar shows its workspaces as a bar shows a
 * compositor's; where they stand is the look's `[bar]`, by their ids
 * (`widget-ids.ts`). Each is given the engine and the Projects, as every
 * widget is (decision 11): what it reads of the Tiling, it reads by
 * selector from what the Window keeps (`kept.ts`), and a click runs an
 * action by its id.
 */
import { sameData, useRun } from "@banda/core/react"
import type { Widget, WidgetProps } from "@banda/ui/module"
import { useContext, useMemo } from "react"
import { AsidePill } from "./AsidePill"
import { AsideContext, useTiled } from "./kept"
import { cellsOf, pagerStateOf } from "./pager/rules"
import { Pager } from "./pager/Pager"
import { ASIDE, WORKSPACES } from "./widget-ids"

/** The Pager (`pager/rules.ts`): what the Tiling holds, as cells, drawn
 * again only as they change. A click goes to a workspace by its place, as
 * the keys of `workspace.go-N` reach only the first nine. */
function PagerWidget({ projects }: WidgetProps) {
  const state = useTiled(pagerStateOf, sameData)
  const cells = useMemo(() => cellsOf(state, projects), [state, projects])
  const run = useRun()
  return (
    <Pager cells={cells} onPick={(index) => run("workspace.go", { index })} />
  )
}

/** The pill, while the workspaces are set aside (ADR 0039, decision 2):
 * what it takes, draws and runs is written at the top of `AsidePill.tsx`. */
function AsideWidget({ engine }: WidgetProps) {
  const aside = useContext(AsideContext)
  return aside ? <AsidePill engine={engine} aside={aside} /> : null
}

/** The Tiling's widgets, which the window's own module lists. */
export const tilingWidgets: readonly Widget[] = [
  {
    id: WORKSPACES,
    about:
      "The Pager: the workspaces, a free one by its number, a Project's by its Sign; click one to go there.",
    Widget: PagerWidget,
    compact: true,
  },
  {
    id: ASIDE,
    about:
      "Says the workspaces are set aside after a start that went wrong, and brings them back.",
    Widget: AsideWidget,
    // No action brings the workspaces back, only its button: it stays.
    compact: true,
  },
]
