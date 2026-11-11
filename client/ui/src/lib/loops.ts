/**
 * The window's loops (ADR 0117): every CSS animation that plays forever,
 * as a Mark's breath, a Group plate's, a spinner or a shimmer, is held
 * still and stepped `STEPS` times a second, all together, to where it
 * would be had it played. Chromium plays one at the screen's rate, on the
 * compositor or not, and while one plays the whole window draws a frame
 * on every refresh: 120 a second on a 120 Hz screen, however little moves.
 * Stepped, the window draws `STEPS` frames a second while something loops,
 * and none once nothing does.
 *
 * A loop is caught as it starts (`animationstart`), so what draws one does
 * nothing for it, and it goes as CSS takes it away (`animationcancel`):
 * `animation: none` while a Mark's news plays, for less motion or
 * `[motion] off`, or another animation for another look. One inside
 * `[data-paused]`, as a Mark out of view or in a hidden window, is not
 * stepped, nor is any while the page is hidden. A time set from outside is
 * kept, as a Mark sets each of its loops' back to 0 when it starts them on
 * its rhythm again; so is a start (`startAt`). One played again from
 * outside is held again at the next step, from where it played.
 *
 * Moves and news are not loops: they end, and play at the screen's rate.
 */

/** How many times a second the loops step (ADR 0117, decision 1). */
export const STEPS = 12

const STEP = 1000 / STEPS

/** A loop held: where on the page's clock it started, and the time last
 * set on it, to tell one set from outside. */
type Held = { origin: number; set: number }

const held = new Map<Animation, Held>()
let timer: ReturnType<typeof setTimeout> | undefined
let page: Document | undefined

/**
 * Holds and steps the loops of `document` from now on, and every loop it
 * already plays. Gives back what lets them go, playing as CSS has them.
 * Once per page: the window's main.tsx starts it.
 */
export function stepLoops(document: Document): () => void {
  if (typeof document.getAnimations !== "function") return () => {}
  page = document
  document.addEventListener("animationstart", onStart, true)
  document.addEventListener("animationcancel", onCancel, true)
  for (const animation of document.getAnimations()) hold(animation)
  return () => {
    document.removeEventListener("animationstart", onStart, true)
    document.removeEventListener("animationcancel", onCancel, true)
    clearTimeout(timer)
    timer = undefined
    for (const animation of held.keys()) animation.play()
    held.clear()
    page = undefined
  }
}

/**
 * Starts `animation` at `at` on the page's clock, as setting its
 * `startTime` does: a loop held stays held and goes on from there, as one
 * of the Group plates that breathe as one (`usePlates`). Nothing changes
 * when it already starts there.
 */
export function startAt(animation: Animation, at: number): void {
  const one = held.get(animation)
  if (!one) {
    if (animation.startTime !== at) animation.startTime = at
    return
  }
  if (one.origin === at) return
  one.origin = at
  one.set = now() - at
  animation.currentTime = one.set
}

/** The page's clock: the document timeline's zero, in milliseconds. */
function now(): number {
  return performance.now()
}

function onStart(event: Event) {
  const { target } = event
  if (!(target instanceof Element)) return
  const { animationName, pseudoElement } = event as AnimationEvent
  // A pseudo-element's loop is the element's, found among its subtree's.
  const all = pseudoElement
    ? target.getAnimations({ subtree: true })
    : target.getAnimations()
  for (const animation of all) {
    const effect = animation.effect as KeyframeEffect | null
    if (
      nameOf(animation) === animationName &&
      effect?.target === target &&
      (effect.pseudoElement ?? "") === (pseudoElement ?? "")
    )
      hold(animation)
  }
}

function onCancel() {
  for (const animation of held.keys())
    if (animation.playState === "idle") held.delete(animation)
}

/** A CSS animation's name, or none for one made in script. */
function nameOf(animation: Animation): string | undefined {
  return "animationName" in animation
    ? (animation as CSSAnimation).animationName
    : undefined
}

/** Whether `animation` loops: a CSS animation that plays forever on the
 * page's own timeline, not on a scroll's. */
function loops(animation: Animation): boolean {
  return (
    nameOf(animation) !== undefined &&
    animation.timeline === page?.timeline &&
    animation.effect?.getTiming().iterations === Infinity
  )
}

function hold(animation: Animation) {
  if (held.has(animation) || !loops(animation)) return
  const at = timeOf(animation) ?? 0
  animation.pause()
  held.set(animation, { origin: now() - at, set: at })
  soon()
}

/** The next step, on the steps every loop shares, so they draw as one. In
 * whole milliseconds, as `setTimeout` keeps them, and never early: a step
 * a hair before its time would leave the next one a hair after it. */
function soon() {
  if (timer !== undefined) return
  let wait = STEP - (now() % STEP)
  if (wait < 1) wait += STEP
  timer = setTimeout(step, Math.ceil(wait))
}

function step() {
  timer = undefined
  const time = now()
  for (const [animation, one] of held) {
    const element = (animation.effect as KeyframeEffect | null)?.target
    // Gone: cancelled, or its element out of the page, which says nothing
    // the page hears.
    if (animation.playState === "idle" || !element?.isConnected) {
      held.delete(animation)
      continue
    }
    const at = timeOf(animation)
    if (at === undefined) continue
    // Played again from outside: held again, from where it played.
    if (animation.playState !== "paused") {
      animation.pause()
      one.origin = time - at
    }
    // Its time set from outside: it goes on from there.
    else if (Math.abs(at - one.set) > 1) one.origin = time - at
    one.set = at
    if (page?.hidden || element.closest("[data-paused]")) continue
    one.set = time - one.origin
    animation.currentTime = one.set
  }
  if (held.size > 0) soon()
}

function timeOf(animation: Animation): number | undefined {
  const time = animation.currentTime
  return typeof time === "number" ? time : undefined
}
