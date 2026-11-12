/** The pulls App's window part (ADR 0076): each Thread's pull requests,
 * listed on that Thread for its card to show (ADR 0098, decision 8). It
 * shows nothing of its own yet: the bar's widget and its popover come
 * with ADR 0076's step 3. */
import { defineModule } from "@banda/ui/module"
import { pullsWatch } from "./PullsWatch"
import { keepItems } from "./threads"

export const pulls = defineModule({
  id: "pulls",
  engine: true,
  watches: [pullsWatch],
  start: (window) => keepItems(window.items),
})
