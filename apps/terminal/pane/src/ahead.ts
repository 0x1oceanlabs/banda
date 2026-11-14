/**
 * What a terminal draws ahead of its machine over a slow link (#1242), as
 * mosh does: a letter typed shows at once, and its machine then confirms
 * it or puts it right. Pure: the Pane tells it what was typed and what
 * the machine sent, and draws what it says.
 *
 * - Only letters that print, one key at a time. Any other key, as Enter,
 *   Backspace or an arrow, and a paste, start over.
 * - Having started over, it shows nothing until the machine sends back
 *   one letter as it was typed. So where the program does not send them
 *   back, as at a password or in a pager, nothing is ever shown.
 * - What the machine sends that is not the next letter waited for takes
 *   everything back: the machine is always right.
 * - It draws only while the machine's answers are slow enough to feel:
 *   the time from a key to its letter coming back, which is what the
 *   Person waits for, and no other measure of the link.
 */

/** From how slow an answer it draws ahead, and below what it stops, in
 * ms: apart, so a link near the edge does not flicker. */
export const SLOW = 60
const QUICK = 40

/** How long after the last key the letters still not sent back are
 * taken back, in ms: the Pane's to time (`lost`). An answer slower than
 * it is a program at work, not the link, and is not measured. */
export const LOST = 1_500

const ESCAPE = "\u001b"

/** Where the colour or style change at `at` of `text` ends, as a shell
 * that paints what is typed sends around a letter: it moves nothing.
 * `at` itself where there is none. */
function pastPaint(text: string, at: number): number {
  if (text[at] !== ESCAPE || text[at + 1] !== "[") return at
  let end = at + 2
  while (end < text.length && "0123456789;:".includes(text[end]!)) end += 1
  return text[end] === "m" ? end + 1 : at
}

/** Whether `data` is one letter that prints in one cell. */
function prints(data: string): boolean {
  return data.length === 1 && data >= " " && data <= "~"
}

export class Ahead {
  /** The letters typed that their machine has not sent back, and when
   * each was typed. */
  #waiting = ""
  #typedAt: number[] = []
  /** The machine sent one back since it last started over. */
  #trusted = false
  /** The time from a key to its letter, smoothed, in ms; none before one. */
  #answer: number | undefined
  #slow = false

  /** What the Person typed, as it goes to the machine, at `now`. */
  typed(data: string, now: number): void {
    if (!prints(data)) return this.over()
    this.#waiting += data
    this.#typedAt.push(now)
  }

  /** What the machine sent, before it is drawn, at `now`. */
  heard(text: string, now: number): void {
    let at = 0
    while (this.#waiting !== "" && at < text.length) {
      const past = pastPaint(text, at)
      if (past !== at) {
        at = past
        continue
      }
      if (text[at] !== this.#waiting[0]) return this.over()
      this.#time(now - this.#typedAt.shift()!)
      this.#waiting = this.#waiting.slice(1)
      this.#trusted = true
      at += 1
    }
  }

  /** Starts over: nothing waits, and nothing shows until the machine
   * sends a letter back again. As the link drops, too, and as
   * `terminal.toml` turns it off. */
  over(): void {
    this.#waiting = ""
    this.#typedAt = []
    this.#trusted = false
  }

  /** Whether a letter typed still waits for its machine: the Pane takes
   * them back `LOST` after the last key. */
  get waits(): boolean {
    return this.#waiting !== ""
  }

  /** The letters to draw after the cursor now. */
  text(): string {
    return this.#slow && this.#trusted ? this.#waiting : ""
  }

  #time(took: number): void {
    if (took > LOST) return
    // As TCP smooths its round trip: an eighth of each new one.
    this.#answer =
      this.#answer === undefined
        ? took
        : this.#answer + (took - this.#answer) / 8
    this.#slow = this.#slow ? this.#answer >= QUICK : this.#answer >= SLOW
  }
}
