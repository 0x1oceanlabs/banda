import { defineModule } from "@banda/ui/module"
import { LimitsWidget } from "./LimitsWidget"

export const harnesses = defineModule({
  id: "harnesses",
  engine: true,
  bar: [
    {
      id: "harnesses.limits",
      about:
        "The fullest usage limit; click for each account's limits and resets.",
      Widget: LimitsWidget,
    },
  ],
})
