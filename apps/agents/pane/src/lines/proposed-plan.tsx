/** The plan a turn in plan mode ended with (ADR 0058). */
import { ProposedPlan } from "../entries/parts/ProposedPlan"
import type { LineProps } from "./types"

export function ProposedPlanLine({ line }: LineProps<"plan">) {
  return <ProposedPlan text={line.item.body.text} />
}
