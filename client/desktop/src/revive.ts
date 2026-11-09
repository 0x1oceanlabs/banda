/**
 * A page of Banda's whose process died, or whose load failed, loads
 * again (#343). The window's arrangement lives in the engine, so the page
 * comes back as it was. Without this the window stays its background
 * colour alone, the engine and its Agents running behind it, until it is
 * closed and opened again.
 *
 * It loads again at most {@link AGAIN_MOST} times within
 * {@link AGAIN_WITHIN}: a page that dies as it loads would else load
 * forever. Past that it stays as it is, and says so in `window.log`.
 */
import type { WebContents } from "electron"

/** How many times a page loads again within {@link AGAIN_WITHIN}. */
export const AGAIN_MOST = 3
/** The span, in ms, that {@link AGAIN_MOST} counts in. */
export const AGAIN_WITHIN = 60_000
/** How long a failed load waits before it is tried again, in ms. */
const FAILED_WAIT = 1_000
/** Chromium's ERR_ABORTED: a load another load replaced, not a failure. */
const ABORTED = -3

/**
 * The times a page loaded again, and whether it may at `now`: it may
 * while fewer than {@link AGAIN_MOST} of them are within
 * {@link AGAIN_WITHIN} of `now`. One that may is counted.
 */
export function againAt(times: number[], now: number): boolean {
  while (times.length > 0 && now - times[0]! >= AGAIN_WITHIN) times.shift()
  if (times.length >= AGAIN_MOST) return false
  times.push(now)
  return true
}

/** Loads `contents` again as its process dies or its load fails, at
 * most as {@link againAt} lets it. */
export function revive(contents: WebContents, now = Date.now): void {
  const times: number[] = []
  const again = (why: string, load: () => unknown) => {
    if (contents.isDestroyed()) return
    if (!againAt(times, now())) {
      console.error(
        `banda: the page ${why}, the ${AGAIN_MOST + 1}th time within ${AGAIN_WITHIN / 1000} s; it is not loaded again`
      )
      return
    }
    console.error(`banda: the page ${why}; loading it again`)
    load()
  }
  contents.on("render-process-gone", (_event, { reason }) => {
    // A page that closed went on purpose. Why one ended is in the log
    // already (problems.ts).
    if (reason === "clean-exit") return
    again("'s process ended", () => contents.reload())
  })
  contents.on(
    "did-fail-load",
    (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === ABORTED) return
      again(`did not load (${description}, ${code})`, () =>
        setTimeout(() => {
          if (!contents.isDestroyed()) void contents.loadURL(url)
        }, FAILED_WAIT)
      )
    }
  )
}
