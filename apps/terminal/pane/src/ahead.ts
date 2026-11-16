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
 * - The machine confirms a letter by leaving it where it was typed, with
 *   the cursor after it, however it got there: a shell that paints what
 *   is typed, or offers the rest of the line after the cursor, as bash
 *   with ble.sh does, writes the line again on each key. While it hides
 *   the cursor it is still writing, and nothing is judged.
 * - Anything else the machine sends takes everything back: the machine
 *   is always right.
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

/** What a shell sends on a key besides letters, that this follows: how
 * far it moves the cursor along its row (`by`), whether it clears the row
 * from the cursor on (`clears`), whether it hides or shows the cursor
 * (`hides`), and where it ends in `text`. A change of colour or style
 * does none of these. Undefined for anything else, and for one cut short. */
function control(
  text: string,
  at: number
): { by: number; clears?: true; hides?: boolean; end: number } | undefined {
  // The plain character set, as a shell ends its paint with.
  if (text.startsWith("(B", at + 1)) return { by: 0, end: at + 3 }
  if (text[at + 1] !== "[") return undefined
  let end = at + 2
  while (end < text.length && "0123456789;:?".includes(text[end]!)) end += 1
  const given = text.slice(at + 2, end)
  const last = text[end]
  end += 1
  if (given === "?25" && (last === "h" || last === "l"))
    return { by: 0, hides: last === "l", end }
  if (given.includes("?")) return undefined
  if (last === "m") return { by: 0, end }
  if (last === "K" && Number(given) === 0) return { by: 0, clears: true, end }
  if (last !== "C" && last !== "D") return undefined
  // None and 0 are one, as a terminal takes them.
  const count = Number(given) || 1
  if (!Number.isInteger(count)) return undefined
  return { by: last === "C" ? count : -count, end }
}

/** Whether `char` takes one cell as it is written: what prints of ASCII,
 * and the letters of the alphabets after it, as a shell may offer from
 * what was typed before. */
function oneCell(char: string): boolean {
  return (
    prints(char) ||
    (char >= "\u00a1" && char < "\u0300") ||
    (char >= "\u0370" && char < "\u0483") ||
    (char >= "\u048a" && char < "\u0530")
  )
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
  /** The machine's row from where the first of them goes, as it wrote it
   * since, and its cursor's column from there. */
  #row: string[] = []
  #column = 0
  /** It hid the cursor and has not shown it: it is writing still. */
  #hidden = false
  /** The machine sent one back since it last started over. */
  #trusted = false
  /** The time from a key to its letter, smoothed, in ms; none before one. */
  #answer: number | undefined
  #slow = false

  /** What the Person typed, as it goes to the machine, at `now`. */
  typed(data: string, now: number): void {
    if (!prints(data)) return this.over()
    // What the machine sent while nothing waited was not followed.
    if (this.#waiting === "") {
      this.#row = []
      this.#column = 0
      this.#hidden = false
    }
    this.#waiting += data
    this.#typedAt.push(now)
  }

  /** What the machine sent, before it is drawn, at `now`. */
  heard(text: string, now: number): void {
    if (this.#waiting === "") return
    for (let at = 0; at < text.length;) {
      const char = text[at]!
      if (char === ESCAPE) {
        const does = control(text, at)
        if (!does) return this.over()
        this.#column += does.by
        if (does.clears) this.#row.length = Math.max(this.#column, 0)
        this.#hidden = does.hides ?? this.#hidden
        at = does.end
        continue
      }
      if (char === "\b") this.#column -= 1
      else if (!oneCell(char)) return this.over()
      // Before the letters that wait is what the machine confirmed already.
      else if (this.#column++ >= 0) this.#row[this.#column - 1] = char
      at += 1
    }
    // The cursor after the letters as typed confirms them, and only that.
    const sent = this.#column
    if (sent === 0 || this.#hidden) return
    if (
      sent < 0 ||
      sent > this.#waiting.length ||
      this.#row.slice(0, sent).join("") !== this.#waiting.slice(0, sent)
    )
      return this.over()
    for (const typedAt of this.#typedAt.splice(0, sent))
      this.#time(now - typedAt)
    this.#waiting = this.#waiting.slice(sent)
    this.#row = this.#row.slice(sent)
    this.#column = 0
    this.#trusted = true
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
