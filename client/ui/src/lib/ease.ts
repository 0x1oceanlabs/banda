/**
 * CSS's easing, worked out in script: the window's moves (`web/src/motion.ts`)
 * and the Mark's news (`mark-rhythm.ts`) draw the same curve the browser
 * plays, so what a script draws meets what CSS draws.
 */

/** CSS's `cubic-bezier()`: the curve's y at time `t` from 0 to 1. */
export function bezierAt(points: readonly number[], t: number): number {
  const [x1, y1, x2, y2] = points as [number, number, number, number]
  const at = (a: number, b: number, s: number) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3
  if (t <= 0) return 0
  if (t >= 1) return 1
  // x is monotonic in s for x1, x2 within 0..1: halve until it is t.
  let low = 0
  let high = 1
  for (let i = 0; i < 40; i++) {
    const s = (low + high) / 2
    if (at(x1, x2, s) < t) low = s
    else high = s
  }
  return at(y1, y2, (low + high) / 2)
}
