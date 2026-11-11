/**
 * How a link in a Pane opens, the same in a Thread and a terminal: a click
 * opens it in Banda's browser, a click with Ctrl, or ⌘, outside Banda.
 */

/** Whether a click opens its link outside Banda. */
export function outsideClick(event: {
  ctrlKey: boolean
  metaKey: boolean
}): boolean {
  return event.ctrlKey || event.metaKey
}

/** What a link under the pointer says: where it goes, and where a click
 * takes it; outside Banda, a page goes to the system's browser. */
export function linkHint(
  shown: string,
  outside = "in external browser"
): string {
  return `${shown}\nClick to open in Banda · Ctrl+click to open ${outside}`
}
