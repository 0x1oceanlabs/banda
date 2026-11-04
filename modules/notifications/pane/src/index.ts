/** The notifications module's window part: the bell on the bar, which
 * shows the last toasts again (ADR 0022, ADR 0048). */
import { defineModule } from "@banda/ui/module"
import { BellWidget } from "./Bell"

export const notifications = defineModule({
  id: "notifications",
  engine: false,
  bar: [
    {
      id: "notifications.recent",
      about: "A click shows the last toasts again.",
      Widget: BellWidget,
    },
  ],
})
