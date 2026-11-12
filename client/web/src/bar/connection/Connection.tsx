/**
 * The engine's connection: a widget that says when this machine's engine
 * does not answer.
 *
 *   in    this machine's engine's status (`useStatus`)
 *   draws nothing while the engine answers; else "Connecting…",
 *         "Reconnecting…", or why it refused, with a spinner or a red dot
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
  if (status.state === "open") return null
  const words =
    status.state === "connecting"
      ? "Connecting…"
      : status.state === "refused"
        ? status.refusal.message
        : "Reconnecting…"
  return (
    <div
      role="status"
      className="flex items-center gap-2 px-2 text-meta text-muted-foreground"
    >
      {status.state === "refused" ? (
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
