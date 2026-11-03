/**
 * The window's frame (ADR 0030): where Banda draws its own title bar, as
 * on macOS, the bar is it. `html[data-frame]` says so, and
 * `--frame-inset` is the room the system's window buttons take at the
 * bar's start (`frame:` in globals.css).
 */
import type { Host } from "./host"

export function followFrame(host: Host | undefined): void {
  if (!host) return
  let told = false
  const take = (inset: number | null) => {
    const root = document.documentElement
    root.toggleAttribute("data-frame", inset !== null)
    root.style.setProperty("--frame-inset", `${inset ?? 0}px`)
  }
  // A frame told while the first answer was on its way is the newer.
  void host.frame.current().then((first) => told || take(first))
  host.frame.listen((inset) => {
    told = true
    take(inset)
  })
}
