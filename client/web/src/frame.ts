/**
 * The window's frame (ADR 0030): where Banda draws its own title bar, as
 * on macOS, the bar is it. `html[data-frame]` says so, and
 * `--frame-inset` is the room the system's window buttons take at the
 * bar's start (`frame:` in globals.css).
 */
import { follow } from "@banda/core"
import type { Host } from "@banda/desktop/bridge"

export function followFrame(host: Host | undefined): void {
  if (!host) return
  follow(host.frame, (inset) => {
    const root = document.documentElement
    root.toggleAttribute("data-frame", inset !== null)
    root.style.setProperty("--frame-inset", `${inset ?? 0}px`)
  })
}
