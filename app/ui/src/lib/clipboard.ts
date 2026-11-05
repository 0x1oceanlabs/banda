/** Puts `text` on the clipboard, as a menu's Copy does; the page may
 * write it, never read it. Nothing for no text. */
export function copyText(text: string): void {
  if (text) void navigator.clipboard.writeText(text)
}
