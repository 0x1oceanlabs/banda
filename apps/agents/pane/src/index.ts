/** The agents module's window part: its Panes, its Watch on what calls
 * for the Person, its action, what the Banda menu finds of it (ADR 0022),
 * what the Person does to a Thread it lists, its item actions (ADR 0087,
 * decision 12), and what it puts in a Slot: a Thread's Mark in its Pane's
 * header (ADR 0062, decision 17). */
import type { ProjectId } from "@banda/contract"
import {
  type Action,
  defineModule,
  scoped,
  takes,
  zoomActions,
} from "@banda/ui/module"
import { actOnTile } from "@banda/ui/hooks/use-scope"
import type { Key } from "@banda/ui/lib/keys"
import { COMPOSER, SUBAGENT, THREAD, VISUAL } from "./scopes"
import { paneOf } from "@banda/ui/pane"
import { threadPane } from "./ThreadPane"
import { visualPane } from "./visual/VisualPane"
import { openBeside, subagentPane } from "./thread/SubagentPane"
import { threadsWatch } from "./list/ThreadsWatch"
import { askSource } from "./list/sources"
import { NEW_THREAD } from "./thread/session"
import { hearBack } from "./thread/WhenBack"
import { threadItems } from "./list/items"
import { threadHeader } from "./list/header"
import { waitingThreads } from "./list/waiting"
import { move } from "./list/marks-moved"
import { answering } from "./list/answering"

/**
 * A new Thread, in a new column, on this computer's first Harness (ADR
 * 0006): a new one at each press, as a browser's new window. Its args: the
 * `project` (else the one in front, `Here.starts`, ADR 0102), and, from
 * the Banda menu, the words to `ask` at once and the `harness` (ADR 0017,
 * decision 6).
 */
const newThread: Action = {
  id: "thread.new",
  args: takes({
    project: "the Project it starts in",
    ask: "what to write to its Agent first",
    harness: "the Harness it starts on",
    place: "drawer: it opens in the drawer, in place of what the drawer held",
  }),
  // Its `ask` goes to the new Thread's Agent at once.
  runsAsPerson: ["ask"],
  title: "New Thread",
  section: "Threads",
  keys: [{ code: "Enter", mod: true }],
  run: (window, args = {}) => {
    const { project, ask, harness, place } = args
    const thread = paneOf(threadPane, {
      ...NEW_THREAD,
      ...(typeof ask === "string" && ask && { ask }),
      ...(typeof harness === "string" && harness && { harness }),
    })
    window.open(
      thread,
      typeof project === "string"
        ? (project as ProjectId)
        : window.here.get().starts,
      place === "drawer" ? { drawer: true } : undefined
    )
  },
}

/** T3 Code's Ctrl+Shift+B: the Thread's details card shown, or hidden;
 * with `part`, shown with that part of its rows open, as git's Switch
 * branch asks for its picker (ADR 0034, decision 4). The Thread in focus
 * takes it, or else the focused Pane's, when that is a Thread. */
const details: Action = {
  id: "agents.thread.details",
  title: "Show or hide the Thread's details",
  section: "Thread",
  scope: THREAD,
  keys: [{ code: "KeyB", primary: true, shift: true }],
  args: takes({
    part: "a part of its rows to open, as git's branch picker, git.branch",
  }),
  run: (_, args) => void actOnTile(THREAD, "agents.thread.details", args),
}

/** A key of one of its scopes (ADR 0071, decision 1), `agents.<scope>.<id>`,
 * which keys.toml binds in that scope's table. */
const own =
  (scope: string, section: string) => (id: string, title: string, key: Key) =>
    scoped(scope, {
      id: `agents.${scope}.${id}`,
      title,
      section,
      keys: [key],
    })

/** The composer's keys: its element runs them (`Composer`); a key its
 * suggestions or its text take, as Enter in code, stays theirs. */
const composer = own(COMPOSER, "Composer")

/** A Thread's keys: its details card and its find are T3 Code's. */
const thread = own(THREAD, "Thread")

/** A sub-agent's Pane's key: Esc, one level up. */
const subagent = own(SUBAGENT, "Sub-agent")

export const agents = defineModule({
  id: "agents",
  engine: true,
  panes: [threadPane, subagentPane, visualPane],
  watches: [threadsWatch],
  actions: [
    newThread,
    ...answering,
    openBeside,
    composer("send", "Send the message, as agents.toml says Enter does", {
      code: "Enter",
    }),
    composer("send-other", "Send it the other way: queued, or steering", {
      code: "Enter",
      primary: true,
    }),
    composer("newline", "A new line in the message", {
      code: "Enter",
      shift: true,
    }),
    composer("back", "The message sent before, from the first line", {
      code: "ArrowUp",
    }),
    composer("forward", "The message sent after, from the last line", {
      code: "ArrowDown",
    }),
    composer("plan", "Plan mode on or off", { code: "Tab", shift: true }),
    // Its zoom sizes its words (ADR 0063, decision 5).
    ...zoomActions(THREAD, "agents.thread", "the Thread", "Thread"),
    details,
    thread("find", "Find in the Thread", { code: "KeyF", primary: true }),
    // T3 Code's keys for the provider, on Ctrl (⌘): Banda's Mod+Shift+↑/↓
    // move the Pane (ADR 0078, decision 11).
    thread(
      "account-previous",
      "Move the Thread to the previous account of its Harness",
      { code: "ArrowUp", primary: true, shift: true }
    ),
    thread(
      "account-next",
      "Move the Thread to the next account of its Harness",
      { code: "ArrowDown", primary: true, shift: true }
    ),
    subagent("up", "Go up to the sub-agent that started this one", {
      code: "Escape",
    }),
    ...zoomActions(VISUAL, "agents.visual", "the Visual", "Visual preview"),
  ],
  scopes: [
    { id: COMPOSER, title: "Composer", field: true },
    { id: THREAD, title: "Thread" },
    { id: SUBAGENT, title: "Sub-agent" },
    { id: VISUAL, title: "Visual preview" },
  ],
  sources: [askSource],
  items: threadItems,
  slots: [threadHeader, waitingThreads],
  // This machine's window moves the marks it kept to their host, once
  // (ADR 0096, decision 9): its own engine's, never another host's, the
  // session of its home, a Project of this machine's. A message that
  // waited for its machine and did not go comes back here (ADR 0105).
  start: (window) => {
    move.start(window.sessionOf(window.home))
    return hearBack(window)
  },
})
