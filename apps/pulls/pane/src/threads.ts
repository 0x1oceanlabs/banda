/**
 * The window's items, as the pulls App reads them once it runs: where its
 * Watch finds the Agent of each Thread a pull request is linked to, as an
 * item `on` a Thread names its Agent (ADR 0029, decision 6). It keeps the
 * Window's own (`WindowApi.items`), as the browser App keeps its window,
 * and no store of its own (#863).
 */
import type { Readable } from "@banda/core/react"
import type { Lists } from "@banda/ui/pane"

const NONE: Lists = {}

/** The Window's items while the App runs; none before. */
let kept: Readable<Lists> | null = null
const listening = new Set<() => void>()
const heard = () => {
  for (const listener of listening) listener()
}

/** The Window's items: none until the App runs, and again once it
 * stops. */
export const items: Readable<Lists> = {
  get: () => kept?.get() ?? NONE,
  subscribe: (listener) => {
    listening.add(listener)
    return () => void listening.delete(listener)
  },
}

/** Reads `window`'s items until the return is called. */
export function keepItems(window: Readable<Lists>): () => void {
  kept = window
  const stop = window.subscribe(heard)
  heard()
  return () => {
    stop()
    if (kept === window) kept = null
    heard()
  }
}
