/**
 * The Thread as a Pane (ADR 0091, decision 5): its kind, and what it gives
 * the Thread it holds. The Thread is `thread/Thread.tsx`.
 */
import { AGENTS_FILE } from "@banda/contract/agents"
import { fileNow } from "@banda/ui/lib/look"
import { ThreadMedia } from "./thread/ThreadMedia"
import { MarkdownShell } from "@banda/ui/components/markdown-code"
import { MarkdownLinks } from "@banda/ui/components/markdown-link"
import { useMemo } from "react"
import { definePane, type PaneProps } from "@banda/ui/pane"
import { MessageSquareIcon } from "lucide-react"
import { NEW_THREAD, type ThreadArgs } from "./thread/session"
import { linkOpener, Thread } from "./thread/Thread"

export const threadPane = definePane<ThreadArgs>({
  kind: "agents.thread",
  title: (args) => args.title || "New Thread",
  shows: (args) => args.thread,
  icon: MessageSquareIcon,
  // No line under it: the messages fade out under it (ADR 0031).
  header: "bare",
  start: NEW_THREAD,
  // A Thread starts with its Harness.
  letter: "H",
  // On its Project's workspace, with the Project's other Agents (ADR 0065).
  home: () => fileNow(AGENTS_FILE).flow !== "free",
  // A Group from its opening, for what its Agent opens (ADR 0065).
  grouped: true,
  // Another host's Thread opens too, on that host's engine (ADR 0081).
  elsewhere: true,
  Pane: ThreadPane,
})

function ThreadPane(props: PaneProps<ThreadArgs>) {
  const project = props.args.scratch ?? props.project
  const { run } = props
  // On another host (ADR 0081), nothing reaches this machine's files: no
  // Run and no media from its paths, and a link opens in the system's
  // browser, as Banda's is not there yet.
  const here = props.args.host === undefined
  // A reply's Run (ADR 0063, decision 6), kept as it is while the Thread
  // streams, so its code blocks draw again only when it changes.
  const runLine = useMemo(
    () =>
      here && run
        ? (line: string) => run("terminal.run", { line, project })
        : null,
    [here, run, project]
  )
  return (
    <ThreadMedia project={here ? project : null}>
      <MarkdownLinks open={linkOpener(here ? run : undefined, project)}>
        <MarkdownShell run={runLine}>
          <Thread {...props} project={project} />
        </MarkdownShell>
      </MarkdownLinks>
    </ThreadMedia>
  )
}
