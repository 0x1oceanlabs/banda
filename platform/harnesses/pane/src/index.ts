import { type Action, defineModule } from "@banda/ui/module"
import { paneOf } from "@banda/ui/pane"
import { LimitsWidget } from "./LimitsWidget"
import { pickLook } from "./look"
import { usagePane } from "./UsagePane"

export { usagePane }
export type { UsageArgs } from "./UsagePane"

/** Opens the Usage Pane from the Banda menu (ADR 0043, decision 6), the
 * one shown if there is. */
const openUsage: Action = {
  id: "harnesses.usage",
  title: "Usage",
  section: "Harnesses",
  run: (window) =>
    window.open(paneOf(usagePane, usagePane.start!), undefined, {
      again: false,
    }),
}

export const harnesses = defineModule({
  id: "harnesses",
  engine: true,
  panes: [usagePane],
  actions: [openUsage, pickLook],
  bar: [
    {
      id: "harnesses.limits",
      about:
        "The room left of each Harness's best account; click for each account's limits.",
      Widget: LimitsWidget,
    },
  ],
})
