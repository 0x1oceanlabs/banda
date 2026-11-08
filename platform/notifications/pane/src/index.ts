/** The notifications module's window part (ADR 0022, ADR 0056): it tells
 * the Person of what calls, and its bell on the bar shows the last toasts
 * again (ADR 0048). */
import type { ProjectId } from "@banda/contract"
import { defineModule } from "@banda/ui/module"
import { BellWidget } from "./Bell"
import { startTelling, type Teller } from "./teller"
import { GO_TO } from "./system"
import { toldOf } from "./told"

/** What tells, while the window runs the module. */
let teller: Teller | null = null

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
  actions: [
    {
      // What a call's toast's button does: goes to its thing.
      id: GO_TO,
      title: "Go to what calls",
      section: "Notifications",
      unlisted: true,
      run: (_, args) => {
        const { project, about, pane } = args ?? {}
        if (typeof project !== "string" || typeof about !== "string") return
        if (!pane || typeof pane !== "object" || Array.isArray(pane)) return
        if (typeof pane.kind !== "string") return
        const paneArgs = pane.args
        if (
          !paneArgs ||
          typeof paneArgs !== "object" ||
          Array.isArray(paneArgs)
        )
          return
        teller?.answer({
          project: project as ProjectId,
          about,
          pane: { kind: pane.kind, args: paneArgs },
        })
      },
    },
    {
      // What another module tells the Person, in plain data (ADR 0056,
      // decision 2): `Told`.
      id: "notifications.tell",
      title: "Tell the Person",
      section: "Notifications",
      unlisted: true,
      run: (_, args) => {
        const told = toldOf(args)
        if (told) void teller?.told(told)
      },
    },
  ],
  start: (window) => {
    const started = startTelling(window)
    teller = started
    return () => {
      started.stop()
      if (teller === started) teller = null
    }
  },
})
