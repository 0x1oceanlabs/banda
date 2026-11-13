/**
 * The engine's connection: a widget that says when this machine's engine
 * does not answer.
 *
 *   in    this machine's engine's status (`useStatus`)
 *   draws nothing while the engine answers; "Connecting…" with a spinner
 *         before it first does; why it refused, with a red dot. Once it
 *         was heard, a connection that is down is its Panes' pill's to
 *         say, as any machine's is (ADR 0124)
 *   runs  nothing
 *
 * It always stands on the bar, last on the right where `[bar]` does not
 * place it (`layout/placed.ts`).
 */
import { Spinner } from "@banda/ui/components/spinner"
import { useStatus } from "@banda/ui/hooks/use-status"
import type { Widget, WidgetProps } from "@banda/ui/module"
import { CONNECTION } from "../widget-ids"

function Connection({ engine }: WidgetProps) {
  const status = useStatus(engine)
  const refused = status.state === "refused"
  if (status.state === "open") return null
  if (!refused && engine.heard !== undefined) return null
  const words = refused ? status.refusal.message : "Connecting…"
  return (
    <div
      role="status"
      className="flex items-center gap-2 px-2 text-meta text-muted-foreground"
    >
      {refused ? (
        <span className="size-2 rounded-full bg-destructive" />
      ) : (
        <Spinner className="size-3" />
      )}
      {words}
    </div>
  )
}

export const connectionWidget: Widget = {
  id: CONNECTION,
  about: "Says when this machine's engine does not answer, and why.",
  Widget: Connection,
}
