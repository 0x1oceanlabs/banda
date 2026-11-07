/** The steps the Agent means to take in its turn. */
import { Plan } from "./parts/Plan"
import type { EntryProps } from "./types"

export function PlanEntry({ item }: EntryProps<"plan">) {
  return <Plan steps={item.body.steps} />
}
