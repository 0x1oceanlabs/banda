/** A Visual in a Pane of its own, beside its Thread (ADR 0037, decision
 * 6): it fills the Pane and scrolls inside it, and it lasts as Panes do. */
import { ChartLineIcon } from "lucide-react"
import { definePane } from "@banda/ui/pane"
import { type VisualArgs, VisualFrame } from "./Frame"

export const visualPane = definePane<VisualArgs>({
  kind: "agents.visual",
  title: (args) => args.title,
  icon: ChartLineIcon,
  // One Pane per Visual.
  identity: (args) => args.visual,
  Pane: ({ project, args }) => (
    <div className="h-full overflow-auto px-6 py-4">
      <VisualFrame project={project} {...args} />
    </div>
  ),
})
