/**
 * A CSV or TSV as a table (ADR 0073, decision 6): which character parts
 * its cells, where each row starts in its bytes, and a run of rows as
 * cells, as RFC 4180 reads them: a cell in quotes may hold the
 * delimiter, a line break, and a quote written twice. A large file is
 * looked through once for where its rows start, and only the rows shown
 * are read again and parsed. Pure, so plain tests cover it.
 */

const QUOTE = 0x22
const LF = 0x0a
const CR = 0x0d

/** The characters a table's cells may be parted by, the likelier first. */
export const DELIMITERS = [",", "\t", ";", "|"] as const
export type Delimiter = (typeof DELIMITERS)[number]

/** What a delimiter is called, as a table's foot says it. */
export const DELIMITER_NAMES: Record<Delimiter, string> = {
  ",": "commas",
  "\t": "tabs",
  ";": "semicolons",
  "|": "bars",
}

/** Where a scan is in a row: at a cell's start, in a plain cell, in a
 * quoted one, or just past a quote in a quoted one. */
type State = "start" | "plain" | "quoted" | "quote"

/** The rows of `text` parted by `delimiter`, each a list of its cells; a
 * CR outside quotes just before a line break is the break's. A blank
 * line is a row of one empty cell; a line break at the very end starts
 * no row. */
export function parseRows(text: string, delimiter: string): string[][] {
  const parting = delimiter.charCodeAt(0)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let state: State = "start"
  // Whether the cell's last character is a CR outside quotes.
  let cr = false
  for (let at = 0; at < text.length; at++) {
    const char = text.charCodeAt(at)
    if (state === "quoted") {
      if (char === QUOTE) state = "quote"
      else cell += text[at]
      continue
    }
    if (char === QUOTE && state !== "plain") {
      // A quote opens a cell, or is the second of two in one.
      if (state === "quote") cell += '"'
      state = "quoted"
      cr = false
    } else if (char === parting) {
      row.push(cell)
      cell = ""
      cr = false
      state = "start"
    } else if (char === LF) {
      row.push(cr ? cell.slice(0, -1) : cell)
      rows.push(row)
      row = []
      cell = ""
      cr = false
      state = "start"
    } else {
      cell += text[at]
      cr = char === CR
      state = "plain"
    }
  }
  if (state !== "start" || row.length > 0) {
    row.push(cr ? cell.slice(0, -1) : cell)
    rows.push(row)
  }
  return rows
}

/** Which delimiter parts `head`, a table's first bytes as text: the one
 * that parts its first rows into the same number of cells, more than
 * one; a TSV's tab unless another does it better. A comma when none. */
export function sniff(head: string, extension = ""): Delimiter {
  // The last line may be cut.
  const cut = head.lastIndexOf("\n")
  const whole = cut > 0 ? head.slice(0, cut) : head
  let best: { delimiter: Delimiter; score: number } | null = null
  for (const delimiter of DELIMITERS) {
    const counts = parseRows(whole, delimiter)
      .slice(0, 50)
      .map((row) => row.length)
    const most = mode(counts)
    if (most < 2) continue
    const alike = counts.filter((count) => count === most).length
    // Rows alike first, then more cells; a TSV's own tab among equals.
    const own = extension === "tsv" && delimiter === "\t" ? 0.5 : 0
    const score = (alike / counts.length) * 1000 + Math.min(most, 100) + own
    if (!best || score > best.score) best = { delimiter, score }
  }
  return best?.delimiter ?? (extension === "tsv" ? "\t" : ",")
}

/** The count most of `counts` are, the larger among equals; 0 for none. */
function mode(counts: readonly number[]): number {
  const seen = new Map<number, number>()
  for (const count of counts) seen.set(count, (seen.get(count) ?? 0) + 1)
  let most = 0
  let times = 0
  for (const [count, n] of seen)
    if (n > times || (n === times && count > most)) [most, times] = [count, n]
  return most
}

/**
 * Where each row of a table starts in its bytes, as the bytes are given
 * piece by piece: a line break in a quoted cell starts none. The bytes
 * from a row's start to the next's are its own; the last's run to the
 * bytes read.
 */
export class RowStarts {
  private starts = new Float64Array(1024)
  private state: State = "start"
  /** Whether the next byte starts a row: the first, and each past a
   * line break outside quotes. */
  private fresh = true
  private readonly delimiter: number
  /** How many rows have started. */
  count = 0
  /** How many bytes were looked through. */
  read = 0
  /** Whether it stopped at its most rows, with bytes left. */
  full = false
  /** The most rows it keeps. */
  readonly most: number

  constructor(delimiter: string, most = 2_000_000) {
    this.delimiter = delimiter.charCodeAt(0)
    this.most = most
  }

  /** Looks through the next bytes. */
  push(bytes: Uint8Array): void {
    if (this.full) return
    let { state, fresh } = this
    const { delimiter } = this
    for (let at = 0; at < bytes.length; at++) {
      const byte = bytes[at]
      if (fresh) {
        if (this.count >= this.most) {
          this.full = true
          this.read += at
          return
        }
        this.add(this.read + at)
        fresh = false
      }
      if (state === "quoted") {
        if (byte === QUOTE) state = "quote"
      } else if (byte === QUOTE && state !== "plain") state = "quoted"
      else if (byte === delimiter) state = "start"
      else if (byte === LF) {
        state = "start"
        fresh = true
      } else state = "plain"
    }
    this.read += bytes.length
    this.state = state
    this.fresh = fresh
  }

  private add(start: number) {
    if (this.count === this.starts.length) {
      const more = new Float64Array(this.starts.length * 2)
      more.set(this.starts)
      this.starts = more
    }
    this.starts[this.count++] = start
  }

  /** Where row `index` starts. */
  start(index: number): number {
    return this.starts[index]
  }

  /** Where row `index` ends, past its last byte. */
  end(index: number): number {
    return index + 1 < this.count ? this.starts[index + 1] : this.read
  }
}

/** A cell as one line shows it: its line breaks as ↵. */
export function shownCell(cell: string): string {
  return cell.includes("\n") ? cell.replace(/\r?\n/g, " ↵ ") : cell
}

/** How wide each column is drawn, in px, by the widest of its cells in
 * `rows` as `measure` reads them, between `least` and `most`. */
export function widthsOf(
  rows: readonly (readonly string[])[],
  measure: (text: string) => number,
  least = 48,
  most = 360
): number[] {
  const columns = Math.max(0, ...rows.map((row) => row.length))
  const widths = new Array<number>(columns).fill(least)
  for (const row of rows)
    row.forEach((cell, column) => {
      const width = Math.min(most, Math.ceil(measure(shownCell(cell))))
      if (width > widths[column]) widths[column] = width
    })
  return widths
}

/** A number as a table's cell may write it: `-1,200.5`, `3e8`, `12%`. */
const NUMBER = /^[-+]?(?=\.?\d)\d[\d,_]*(\.\d*)?([eE][-+]?\d+)?%?$|^[-+]?\.\d+$/

/** Which columns hold numbers: every cell past the header that holds
 * something is one. They are drawn on the right. */
export function numericColumns(
  rows: readonly (readonly string[])[]
): boolean[] {
  const columns = Math.max(0, ...rows.map((row) => row.length))
  return Array.from({ length: columns }, (_, column) => {
    const cells = rows
      .slice(1)
      .map((row) => row[column]?.trim() ?? "")
      .filter(Boolean)
    return cells.length > 0 && cells.every((cell) => NUMBER.test(cell))
  })
}
