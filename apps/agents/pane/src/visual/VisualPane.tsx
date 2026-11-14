/** A Visual in a Pane of its own, beside its Thread (ADR 0037, decision
 * 6): it fills the Pane and scrolls inside it, and it lasts as Panes do. */
import { ChartLineIcon } from "lucide-react"
import { usePlaced } from "@banda/core/react"
import { definePane, type PaneProps } from "@banda/ui/pane"
import { type VisualArgs, VisualFrame } from "./Frame"

export const visualPane = definePane<VisualArgs>({
  kind: "agents.visual",
  name: "Visual",
  title: (args) => args.title,
  icon: ChartLineIcon,
  // One Pane per Visual.
  identity: (args) => args.visual,
  // Another machine's Visual opens too, its page from that machine's
  // engine (ADR 0106, step 4d).
  elsewhere: true,
  Pane: VisualPane,
})

function VisualPane({ project, args, engine, run }: PaneProps<VisualArgs>) {
  const { host } = usePlaced(project, undefined)
  const place = {
    engine,
    project,
    host,
    openLink: (url: string) => run?.("link.open", { url }),
  }
  return (
    <div className="h-full overflow-auto px-6 py-4">
      <VisualFrame place={place} {...args} />
    </div>
  )
}
