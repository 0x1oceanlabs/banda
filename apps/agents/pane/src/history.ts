/**
 * ↑ and ↓ in an empty composer walk the Person's earlier messages to the
 * Thread, as in T3 Code (ADR 0010, decision 7). Pure, so plain tests
 * cover it.
 */

/** What ↑ or ↓ does: show an earlier message, `back` messages back, or
 * open the last message that waits, to edit. */
export type Step = { text: string; back: number } | "edit"

/**
 * One step `up` or down through `history`, oldest first: `back` messages
 * back now, 0 for none, with `text` in the composer. While a message
 * `waits`, ↑ from an empty box opens it to edit: Alt+↑ in T3 Code, but
 * Alt and the arrows move between Panes here. Undefined when the keys
 * should move the caret instead, because the Person wrote something of
 * their own or there is no further to go.
 */
export function recall(
  history: readonly string[],
  back: number,
  text: string,
  up: boolean,
  waits: boolean
): Step | undefined {
  const nth = (n: number) => (n === 0 ? "" : history[history.length - n])
  if (text !== nth(back)) return undefined
  if (waits && up && back === 0) return "edit"
  const next = back + (up ? 1 : -1)
  if (next < 0 || next > history.length) return undefined
  return { text: nth(next), back: next }
}
