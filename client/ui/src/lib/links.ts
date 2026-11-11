/**
 * How a link in a Pane opens, the same in a Thread and a terminal: a click
 * opens it in Banda's browser, a click with Ctrl, or ⌘, outside Banda.
 */
import { linkOf } from "@banda/core"

/** Whether a click opens its link outside Banda. */
export function outsideClick(event: {
  ctrlKey: boolean
  metaKey: boolean
}): boolean {
  return event.ctrlKey || event.metaKey
}

/** What a link under the pointer says: where it goes, and where a click
 * takes it; outside Banda, a page goes to the system's browser. With
 * `outside` null, as for another machine's file, Ctrl does nothing more. */
export function linkHint(
  shown: string,
  outside: string | null = "in external browser"
): string {
  const click = `${shown}\nClick to open in Banda`
  return outside === null ? click : `${click} · Ctrl+click to open ${outside}`
}

/** Opens a page in this device's browser, the device's own act (ADR 0106,
 * decision 3). Only an http(s) address leaves the page, whatever Pane
 * hands it. */
export function openOutside(url: string): void {
  if (linkOf(url)) window.open(url, "_blank", "noopener")
}
