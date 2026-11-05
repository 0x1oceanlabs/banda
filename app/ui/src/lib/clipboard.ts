/** What a Copy puts on the clipboard: its text, and HTML where it has a
 * look of its own. */
export type Copied = { text: string; html?: string }

/** Puts `text` on the clipboard, as a menu's Copy does; the page may
 * write it, never read it. Nothing for no text. */
export function copyText(text: string): void {
  if (text) void navigator.clipboard.writeText(text)
}

/** Puts what was copied on the clipboard, its HTML beside its text. */
export function copyRich({ text, html }: Copied): void {
  if (!html) return copyText(text)
  void navigator.clipboard.write([
    new ClipboardItem({
      "text/plain": new Blob([text], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" }),
    }),
  ])
}
