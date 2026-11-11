/** The clock App's window part: the time and the day on the bar, and the
 * month a click shows (ADR 0024, decision 3). It has no engine part: the
 * time and the calendar are this device's. */
import { defineModule } from "@banda/ui/module"
import { ClockWidget } from "./Clock"

export const clock = defineModule({
  id: "clock",
  engine: false,
  bar: [
    {
      id: "clock.now",
      about:
        "The day and the time, by this device's clock and language; a click shows the month, with its weeks' numbers.",
      Widget: ClockWidget,
    },
  ],
})
