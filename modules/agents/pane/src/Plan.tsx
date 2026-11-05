import type { PlanStep, StepState } from "@banda/contract/agents"
import { CheckIcon, CircleDashedIcon, ListTodoIcon } from "lucide-react"
import { Card } from "./Card"

/** What an Agent means to do in its turn, step by step, as far as it got:
 * a step done is checked and quiet, the one it does now turns, the rest
 * wait in a dashed ring. */
export function Plan({ steps }: { steps: PlanStep[] }) {
  // A plan the Agent cleared shows nothing.
  if (steps.length === 0) return null
  const done = steps.filter((step) => step.state === "done").length
  return (
    <Card
      region
      icon={<ListTodoIcon />}
      title="Plan"
      action={
        <span className="text-xs text-muted-foreground tabular-nums">
          {done} of {steps.length}
        </span>
      }
    >
      <ol className="flex flex-col pb-2">
        {steps.map(({ text, state }, at) => (
          <li
            key={at}
            data-state={state}
            className="flex items-start gap-2 px-3 py-1 data-[state=done]:text-muted-foreground data-[state=pending]:text-muted-foreground"
          >
            <span
              role="img"
              aria-label={STEP_WORDS[state]}
              className="flex h-5 w-3.75 shrink-0 items-center justify-center"
            >
              <StepMark state={state} />
            </span>
            <span className="min-w-0 wrap-break-word">{text}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function StepMark({ state }: { state: StepState }) {
  switch (state) {
    case "done":
      return (
        <span className="flex size-3.75 items-center justify-center rounded-full bg-muted-foreground text-block">
          <CheckIcon className="size-2.5" strokeWidth={3} />
        </span>
      )
    case "in_progress":
      return (
        <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-foreground/15 border-t-foreground motion-reduce:animate-none" />
      )
    case "pending":
      return <CircleDashedIcon className="size-3.75" />
  }
}

const STEP_WORDS: Record<StepState, string> = {
  pending: "To do",
  in_progress: "Doing now",
  done: "Done",
}
