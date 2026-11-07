/**
 * The system's accent (ADR 0075, decision 6): the one set in macOS's or
 * Windows' settings, as `--system-accent` on the root. The `macos` theme's
 * accent is this variable, so its focus, rings and buttons take the
 * Person's colour; without one, globals.css gives Apple's blue.
 */
import { follow, type Host } from "./host"

export function followAccent(host: Host | undefined): void {
  if (!host) return
  follow(host.accent, (accent) => {
    const root = document.documentElement
    if (accent) root.style.setProperty("--system-accent", accent)
    else root.style.removeProperty("--system-accent")
  })
}
