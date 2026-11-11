/** What a Copy puts on the clipboard: its text, and HTML where it has a
 * look of its own. */
export type Copied = { text: string; html?: string }

/** Puts `text` on the clipboard, as a menu's Copy does; the page may
 * write it, never read it. Nothing for no text, and resolved once done
 * or refused: a page without the focus may not write, which is no
 * problem to report. */
export async function copyText(text: string): Promise<void> {
  if (text) await navigator.clipboard.writeText(text).catch(() => undefined)
}

/** Puts what was copied on the clipboard, its HTML beside its text. */
export function copyRich({ text, html }: Copied): void {
  if (!html) return void copyText(text)
  void navigator.clipboard.write([
    new ClipboardItem({
      "text/plain": new Blob([text], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" }),
    }),
  ])
}
