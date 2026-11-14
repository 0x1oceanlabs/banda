/** The terminal module's window part: its Pane, its actions, its widget of the
 * servers started in Banda and its section of Settings (ADR 0022, ADR
 * 0044). */
import type { ProjectId } from "@banda/contract"
import { aboutOf } from "@banda/contract/settings"
import { defineModule, zoomActions } from "@banda/ui/module"
import { paneOf } from "@banda/ui/pane"
import { TerminalIcon } from "lucide-react"
import { ServersWidget } from "./Servers"
import { TERMINAL } from "./scopes"
import { NEW_TERMINAL, terminalPane } from "./TerminalPane"

export { terminalPane }
export type { Done, TerminalArgs } from "./TerminalPane"

export const terminal = defineModule({
  id: "terminal",
  engine: true,
  panes: [terminalPane],
  actions: [
    {
      id: "terminal.new",
      title: "New terminal",
      section: "Panes",
      keys: [{ code: "Enter", mod: true, more: true }],
      run: (window) => window.open(paneOf(terminalPane, NEW_TERMINAL)),
    },
    {
      // A shell's `line`, typed into a new shell of `project` beside what
      // asked: a reply's Run (ADR 0063, decision 6). The Person pressed
      // it; nothing else hands a shell a line. It declares no `args`, so
      // no line of keys.toml, the Person's or an Agent's, can carry one
      // (ADR 0071, decision 3).
      id: "terminal.run",
      title: "Run in a terminal",
      section: "Panes",
      unlisted: true,
      run: (window, args = {}) => {
        const { line, project } = args
        if (typeof line !== "string" || !line.trim()) return
        window.open(
          paneOf(terminalPane, { ...NEW_TERMINAL, typed: line }),
          typeof project === "string" ? (project as ProjectId) : undefined
        )
      },
    },
    // Its own zoom, Ctrl with + − 0, as Ghostty's and kitty's.
    ...zoomActions(TERMINAL, "terminal", "the terminal", "Terminal"),
  ],
  scopes: [{ id: TERMINAL, title: "Terminal" }],
  settings: {
    id: "terminal",
    title: "Terminal",
    icon: TerminalIcon,
    files: [{ name: "terminal.toml" }],
    about: aboutOf("terminal.toml"),
  },
  bar: [
    {
      id: "terminal.ports",
      about:
        "The servers started in Banda: the first one's port and how many more; a click lists them.",
      Widget: ServersWidget,
    },
  ],
})
