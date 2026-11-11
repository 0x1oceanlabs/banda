/**
 * The loops the window holds and steps (ADR 0117), as a second of them
 * shows: for each loop's name, how many of that name play, whether every
 * one is held, and how many times their time moved in the second, at
 * most. A loop the page plays moves on every frame, 60 times a second on
 * a headless screen; a stepped one moves 12 times. A loop inside
 * `[data-paused]`, a Mark out of view, waits, and is left out.
 */
import type { Locator } from "@playwright/test"

export type Stepped = {
  name: string
  count: number
  held: boolean
  steps: number
}

/** The loops under `where`, `ms` of them. */
export function steppedOf(where: Locator, ms = 1000): Promise<Stepped[]> {
  return where.evaluate(
    (root, ms) =>
      new Promise<Stepped[]>((done) => {
        const all = root.getAnimations({ subtree: true }).filter((one) => {
          const target = (one.effect as KeyframeEffect | null)?.target
          return (
            one.effect?.getTiming().iterations === Infinity &&
            one.timeline === document.timeline &&
            !target?.closest("[data-paused]")
          )
        })
        const seen = all.map(() => new Set<number>())
        const look = () =>
          all.forEach((one, i) => seen[i]!.add(Number(one.currentTime)))
        look()
        const timer = setInterval(look, 4)
        setTimeout(() => {
          clearInterval(timer)
          const byName = new Map<string, Stepped>()
          all.forEach((one, i) => {
            const name = (one as CSSAnimation).animationName
            const stepped = byName.get(name) ?? {
              name,
              count: 0,
              held: true,
              steps: 0,
            }
            stepped.count += 1
            stepped.held &&= one.playState === "paused"
            stepped.steps = Math.max(stepped.steps, seen[i]!.size - 1)
            byName.set(name, stepped)
          })
          done(
            [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
          )
        }, ms)
      }),
    ms
  )
}

/** How many times a second a held loop's time may move: 12 steps, and
 * one more where the second's first sample falls just before a step. */
export const STEPS_AT_MOST = 13
/** And at least, on a busy machine whose timers run late. */
export const STEPS_AT_LEAST = 6
