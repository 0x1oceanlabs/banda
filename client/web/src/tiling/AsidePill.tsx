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

/**
 * While the workspaces are set aside, the bar says so, quietly, and
 * brings them back (ADR 0039, decision 2).
 */
export function AsidePill({ engine, aside }: { engine: Engine; aside: Aside }) {
  const { busy, problem, bring } = useBringBack(engine)
  return (
    <div
      role="status"
      title={problem}
      className="mr-1 flex items-center gap-2 rounded-full border border-attention/50 bg-attention/10 py-0.5 pr-0.5 pl-2.5 text-xs"
    >
      <span>
        <span className="font-medium">Workspaces set aside</span>
        <span className="text-muted-foreground"> · {asideWords(aside)}</span>
      </span>
      <Button
        size="xs"
        className="h-5 rounded-full px-2 text-[11px]"
        disabled={busy}
        onClick={bring}
      >
        Bring them back
      </Button>
    </div>
  )
}
