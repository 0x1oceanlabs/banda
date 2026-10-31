/**
 * What a file change did, line by line, for a Person to read: the lines it
 * removed and added, and a few unchanged ones around them.
 */

export type Line = { kind: "same" | "added" | "removed"; text: string }

/** Lines left out between two parts of a change. */
export type Gap = { kind: "gap"; lines: number }

/** Beyond this many changed lines, or this many steps of looking, the
 * change shows as all removed, then all added: finding the fewest would
 * take too long. */
const MOST_CHANGES = 1000
const MOST_STEPS = 2_000_000

function lines(text: string): string[] {
  if (text === "") return []
  const all = text.split("\n")
  return all.at(-1) === "" ? all.slice(0, -1) : all
}

/** Every line of `before` and `after`, each kept, removed or added; the
 * fewest changes, as Myers finds them. Without `before` the file is new. */
export function lineDiff(before: string | undefined, after: string): Line[] {
  const a = lines(before ?? "")
  const b = lines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++
  const same = (text: string): Line => ({ kind: "same", text })
  const middleA = a.slice(start, a.length - end)
  const middleB = b.slice(start, b.length - end)
  const middle = myers(middleA, middleB) ?? [
    ...middleA.map((text): Line => ({ kind: "removed", text })),
    ...middleB.map((text): Line => ({ kind: "added", text })),
  ]
  return [
    ...a.slice(0, start).map(same),
    ...middle,
    ...a.slice(a.length - end).map(same),
  ]
}

function myers(a: string[], b: string[]): Line[] | null {
  const [n, m] = [a.length, b.length]
  const offset = MOST_CHANGES + 1
  const v = new Int32Array(2 * offset + 1)
  // After each step d, the furthest x on each diagonal k in -d..d.
  const steps: Int32Array[] = []
  let looked = 0
  for (let d = 0; d <= Math.min(n + m, MOST_CHANGES); d++) {
    for (let k = -d; k <= d; k += 2) {
      if (++looked > MOST_STEPS) return null
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
        looked++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        steps.push(v.slice(offset - d, offset + d + 1))
        return walkBack(steps, a, b)
      }
    }
    steps.push(v.slice(offset - d, offset + d + 1))
  }
  return null
}

function walkBack(steps: Int32Array[], a: string[], b: string[]): Line[] {
  const out: Line[] = []
  let [x, y] = [a.length, b.length]
  for (let d = steps.length - 1; d > 0; d--) {
    const furthest = (k: number) => steps[d - 1][k + d - 1]
    const k = x - y
    const from =
      k === -d || (k !== d && furthest(k - 1) < furthest(k + 1)) ? k + 1 : k - 1
    const fromX = furthest(from)
    const fromY = fromX - from
    while (x > fromX && y > fromY) {
      out.push({ kind: "same", text: a[--x] })
      y--
    }
    if (x === fromX) out.push({ kind: "added", text: b[--y] })
    else out.push({ kind: "removed", text: a[--x] })
  }
  while (x > 0 && y > 0) {
    out.push({ kind: "same", text: a[--x] })
    y--
  }
  return out.reverse()
}

/** The changed lines with `context` unchanged ones around each part, and
 * a gap where more are left out. */
export function parts(diff: Line[], context = 3): (Line | Gap)[] {
  const near = diff.map(() => false)
  diff.forEach((line, at) => {
    if (line.kind === "same") return
    const from = Math.max(0, at - context)
    const to = Math.min(diff.length - 1, at + context)
    for (let i = from; i <= to; i++) near[i] = true
  })
  const out: (Line | Gap)[] = []
  diff.forEach((line, at) => {
    if (near[at]) out.push(line)
    else if (out.at(-1)?.kind === "gap") (out.at(-1) as Gap).lines++
    else out.push({ kind: "gap", lines: 1 })
  })
  return out
}

/** How many lines a change added and removed. */
export function counts(diff: Line[]): { added: number; removed: number } {
  return {
    added: diff.filter((l) => l.kind === "added").length,
    removed: diff.filter((l) => l.kind === "removed").length,
  }
}
