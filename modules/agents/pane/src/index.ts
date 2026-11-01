/** The agents module's window part: its Panes, and its Watch on what
 * calls for the Person (ADR 0022). */
import { defineModule } from "@banda/ui/module"
import { diffPane } from "./DiffPane"
import { threadPane } from "./ThreadPane"
import { threadsPane } from "./ThreadsPane"
import { threadsWatch } from "./ThreadsWatch"

export { diffPane, threadPane, threadsPane, threadsWatch }
export { NEW_THREAD, type ThreadArgs } from "./session"
export { useSpaceFiles } from "./FileMenu"
export { useHarnesses } from "./harnesses"

export const agents = defineModule({
  id: "agents",
  engine: true,
  panes: [threadPane, threadsPane, diffPane],
  watches: [threadsWatch],
})
