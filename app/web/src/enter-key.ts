/**
 * Before ADR 0016 the window kept what Enter does in its own storage. Once,
 * a choice kept there moves into `agents.toml`, unless the file says
 * already, and the storage forgets it: the file is the one source now.
 */
import { tomlOf } from "@banda/contract/settings"
import type { Host } from "./host"

const KEPT = "banda.agents.enter-key"

export async function moveEnterKey(host: Host): Promise<void> {
  let kept: string | null
  try {
    kept = localStorage.getItem(KEPT)
  } catch {
    return
  }
  if (kept === null) return
  const look = await host.look.current()
  // Without the look yet, the next start moves it.
  if (!look) return
  const said = look.settings["agents.toml"]?.enter?.from.layer === "file"
  if (kept === "queue" && !said) {
    const refused = await host.settings.set(
      "agents.toml",
      "enter",
      tomlOf(kept)
    )
    if (refused.length > 0) return
  }
  localStorage.removeItem(KEPT)
}
