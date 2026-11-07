import { Button } from "@banda/ui/components/button"
import { CopyButton } from "@banda/ui/components/copy-button"
import { Markdown } from "@banda/ui/components/markdown"
import { cn } from "@banda/ui/lib/utils"
import { ListChecksIcon } from "lucide-react"
import { Card, CardBody, Docked } from "./Card"
import { THREAD_ZOOM, useClamp } from "./Messages"

/**
 * The plan an Agent proposed in plan mode, as a card (ADR 0010, decision
 * 6): its words in markdown, Copy, and a long one clamped until opened.
 * `children` come after it: what became of a plan a Harness asks to carry
 * out.
 */
export function ProposedPlan({
  text,
  children,
}: {
  text: string
  children?: React.ReactNode
}) {
  const clamp = useClamp(text, "max-h-60", "Show the whole plan")
  return (
    <Card
      icon={<ListChecksIcon />}
      title="Plan"
      label="Proposed plan"
      action={<CopyButton text={text} label="Copy the plan" />}
    >
      <CardBody>
        <Markdown
          // A plan starts with its heading at the card's top: the chat's
          // headings keep their margin even first.
          className={cn("[&>:first-child]:mt-0!", THREAD_ZOOM, clamp.className)}
        >
          {text}
        </Markdown>
        {clamp.toggle && (
          // Quiet, as the bubble's, its words on the text's edge.
          <div className="-mt-1 -ml-2 flex text-muted-foreground">
            {clamp.toggle}
          </div>
        )}
        {children}
      </CardBody>
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
    <Docked
      label="Plan ready"
      className="flex items-center gap-2 py-2 pr-2 pl-4"
    >
      <ListChecksIcon className="size-3.75 shrink-0 text-muted-foreground" />
      <span className="font-[550]">Plan ready</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {title}
      </span>
      <Button size="sm" disabled={busy} onClick={onImplement}>
        Implement
      </Button>
    </Docked>
  )
}
