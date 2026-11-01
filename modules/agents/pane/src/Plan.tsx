import type { PlanStep, StepState } from "@banda/contract/agents"
import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  ListTodoIcon,
  type LucideIcon,
} from "lucide-react"

/** What an Agent means to do in its turn, step by step, as far as it got. */
export function Plan({ steps }: { steps: PlanStep[] }) {
  // A plan the Agent cleared shows nothing.
  if (steps.length === 0) return null
  const done = steps.filter((step) => step.state === "done").length
  return (
    <section
      aria-label="Plan"
      className="flex flex-col gap-2 rounded-xl border bg-card p-3 text-sm"
    >
      <div className="flex items-center gap-2 font-medium">
        <ListTodoIcon className="size-4 shrink-0 text-muted-foreground" />
        Plan
        <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
          {done} of {steps.length} done
        </span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {steps.map(({ text, state }, at) => {
          const Icon = STEP_ICONS[state]
          return (
            <li
              key={at}
              data-state={state}
              className="flex items-start gap-2 data-[state=done]:text-muted-foreground data-[state=pending]:text-muted-foreground"
            >
              <Icon
                aria-label={STEP_WORDS[state]}
                className="mt-0.5 size-4 shrink-0 in-data-[state=in_progress]:text-primary"
              />
              <span className="min-w-0 wrap-break-word in-data-[state=done]:line-through">
                {text}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

const STEP_ICONS: Record<StepState, LucideIcon> = {
  pending: CircleIcon,
  in_progress: CircleDotIcon,
  done: CircleCheckIcon,
}

const STEP_WORDS: Record<StepState, string> = {
  pending: "To do",
  in_progress: "Doing now",
  done: "Done",
}
