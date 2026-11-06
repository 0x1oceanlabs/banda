/** The agents module's window part: its Panes, its Watch on what calls
 * for the Person, its action, what the Banda menu finds of it (ADR 0022)
 * and how the window names its Threads (ADR 0077). */
import type { ProjectId } from "@banda/contract"
import type { ThreadId } from "@banda/contract/agents"
import {
  type Action,
  defineModule,
  type Listing,
  takes,
} from "@banda/ui/module"
import { paneOf } from "@banda/ui/pane"
import { threadPane } from "./ThreadPane"
import { visualPane } from "./VisualPane"
import { threadsWatch } from "./ThreadsWatch"
import { askSource, filesSource } from "./sources"
import { NEW_THREAD } from "./session"
import { markUnread } from "./seen"

/**
 * A new Thread, in a new column, on this computer's first Harness (ADR
 * 0006): a new one at each press, as a browser's new window. Its args: the
 * `project` (the home Project else), and, from the Banda menu, the words to
 * `ask` at once and the `harness` (ADR 0017, decision 6).
 */
const newThread: Action = {
  id: "thread.new",
  args: takes({
    project: "the Project it starts in",
    ask: "what to write to its Agent first",
    harness: "the Harness it starts on",
  }),
  title: "New Thread",
  section: "Threads",
  keys: [{ code: "Enter", mod: true }],
  run: (window, args = {}) => {
    const { project, ask, harness } = args
    const thread = paneOf(threadPane, {
      ...NEW_THREAD,
      ...(typeof ask === "string" && ask && { ask }),
      ...(typeof harness === "string" && harness && { harness }),
    })
    window.open(
      thread,
      typeof project === "string" ? (project as ProjectId) : window.home
    )
  },
}

/**
 * How the window names a Thread and marks it unread (ADR 0077): the
 * engine renames it, and its Harness's small model suggests the name; the
 * "seen" is this window's (ADR 0005, decision 8).
 */
const threads: Listing = {
  rename: async (engine, project, id, title) => {
    const thread = id as ThreadId
    await engine.command(
      "agents.rename",
      title === null ? { thread } : { thread, title },
      project
    )
  },
  suggest: (engine, project, id) =>
    engine.command("agents.suggest_title", { thread: id as ThreadId }, project),
  unread: markUnread,
}

export const agents = defineModule({
  id: "agents",
  engine: true,
  panes: [threadPane, visualPane],
  watches: [threadsWatch],
  actions: [newThread],
  sources: [filesSource, askSource],
  listed: threads,
})
