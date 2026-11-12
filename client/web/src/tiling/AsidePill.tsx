/**
 * The workspaces set aside: the Tiling's widget `workspaces.aside` on the
 * bar (ADR 0039, decision 2). While a start that went wrong left the
 * workspaces set aside, the bar says so, quietly, and brings them back.
 * The widget itself is a line in `widgets.tsx` that hands this pill what
 * the Window gives.
 *
 *   in    aside    how many workspaces and Panes are set aside, from the
 *                  arrangement as the engine says it, which the Window
 *                  gives by `AsideContext` (`kept.ts`)
 *         engine   this machine's engine, to bring them back
 *   draws nothing while none are set aside; else a pill, "Workspaces set
 *         aside · 3 workspaces, 7 Panes", and its Bring them back
 *         button, with why it failed in its title
 *   runs  the engine's command `workspaces.bring_back`
 *   gives `asideWords` and `useBringBack` to Settings → Projects' row
 *         (`../safe/AsideRow.tsx`)
 */
import type { Engine } from "@banda/contract"
import type { Aside } from "@banda/contract/workspaces"
import { Button } from "@banda/ui/components/button"
import { useAct } from "@banda/ui/hooks/use-act"

/** The workspaces set aside, in words: "3 workspaces, 7 Panes". */
export function asideWords(aside: Aside): string {
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
  return `${count(aside.workspaces, "workspace")}, ${count(aside.panes, "Pane")}`
}

/** Brings the workspaces set aside back, after the ones there are now. The
 * pill and Settings' row both bring them back with it. */
export function useBringBack(engine: Engine) {
  const { busy, problem, act } = useAct()
  const bring = () =>
    void act(() => engine.command("workspaces.bring_back", {}))
  return { busy, problem, bring }
}

/** The pill, as the top of this file says. */
export function AsidePill({ engine, aside }: { engine: Engine; aside: Aside }) {
  const { busy, problem, bring } = useBringBack(engine)
  return (
    <div
      role="status"
      title={problem}
      className="mr-1 flex items-center gap-2 rounded-full border border-attention/50 bg-attention/10 py-0.5 pr-0.5 pl-2.5 text-meta"
    >
      <span>
        <span className="font-medium">Workspaces set aside</span>
        <span className="text-muted-foreground"> · {asideWords(aside)}</span>
      </span>
      <Button
        size="xs"
        className="h-5 rounded-full px-2 text-meta"
        disabled={busy}
        onClick={bring}
      >
        Bring them back
      </Button>
    </div>
  )
}
