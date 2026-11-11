/**
 * A pasted text too long for the box is kept as a file the message
 * names, as in T3 Code; Mod+Shift+V pastes it as text. Pure, so plain
 * tests cover it.
 */

/** A pasted text this long or longer is kept as a file. */
const LONG_PASTE = 32 * 1024
/** A long text kept as a file, as the message names it. */
const PASTED = /pasted-text-\d+\.txt/g

/** Whether a pasted text is {@link LONG_PASTE} bytes or more: a character
 * is one byte or more, and at most three. */
export function long(text: string): boolean {
  if (text.length * 3 < LONG_PASTE) return false
  return text.length >= LONG_PASTE || new Blob([text]).size >= LONG_PASTE
}

/** The file a long `pasted` text is kept as, named after those the
 * message `written` names already. */
export function pastedFile(pasted: string, written: string): File {
  const name = `pasted-text-${(written.match(PASTED)?.length ?? 0) + 1}.txt`
  return new File([pasted], name, { type: "text/plain" })
}
