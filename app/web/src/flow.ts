/**
 * The Flow: how an Agent's windows stand, free, in a row or solo (ADR
 * 0079). It is `flow` in agents.toml; the window writes it as the theme
 * menu writes look.toml, and the look brings the change back.
 */
import { AGENTS_FILE, type Flow } from "@banda/contract/agents"
import { tomlOf } from "@banda/contract/settings"
import { fileNow } from "@banda/ui/lib/look"

/** Writes the Flow into agents.toml. */
export function writeFlow(flow: Flow): void {
  window.banda?.settings.set("agents.toml", "flow", tomlOf(flow)).then(
    (refused) => {
      if (refused.length > 0)
        console.error("banda: agents.toml refused", refused)
    },
    (error: unknown) =>
      console.error("banda: agents.toml was not written", error)
  )
}

/** `Alt+Shift+M`: from the row to solo and back; from free to solo. */
export function toggleSolo(): void {
  writeFlow(fileNow(AGENTS_FILE).flow === "solo" ? "row" : "solo")
}
