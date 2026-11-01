import { Button } from "@banda/ui/components/button"
import { CopyButton } from "@banda/ui/components/copy-button"
import { Markdown } from "@banda/ui/components/markdown"
import { ListChecksIcon } from "lucide-react"
import { Card } from "./Card"
import { useClamp } from "./Messages"

/**
 * The plan an Agent proposed in plan mode, as a card (ADR 0010, decision
 * 6): its words in markdown, Copy, and a long one clamped until opened.
 */
export function ProposedPlan({ text }: { text: string }) {
  const clamp = useClamp(text, "max-h-60", "Show the whole plan")
  return (
    <Card
      icon={<ListChecksIcon />}
      title="Plan"
      label="Proposed plan"
      action={<CopyButton text={text} label="Copy the plan" />}
    >
      <Markdown className={clamp.className}>{text}</Markdown>
      {clamp.toggle}
    </Card>
  )
}

/**
 * On the composer once a plan is ready, as T3 Code shows it: Implement
 * turns plan mode off and asks the Agent to carry the plan out; a message
 * written instead refines it.
 */
export function PlanReady({
  title,
  busy,
  onImplement,
}: {
  title: string
  busy: boolean
  onImplement: () => void
}) {
  return (
    <div
      role="group"
      aria-label="Plan ready"
      className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm shadow-sm"
    >
      <ListChecksIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="font-medium">Plan ready</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {title}
      </span>
      <Button size="sm" disabled={busy} onClick={onImplement}>
        Implement
      </Button>
    </div>
  )
}
