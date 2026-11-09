/**
 * Here from React (ADR 0087, decision 4): the Window gives its own to what
 * it draws, and a widget reads the fields it needs by selector.
 */
import { createContext, useContext } from "react"
import type { Here, HereStore } from "../here"
import { Store } from "../store"
import { useStore } from "./store"

/** Here where no Window keeps one, as in a test. */
const NOWHERE: Here = {
  front: false,
  sidebar: false,
  workspace: null,
  pane: null,
  project: "",
}

/** The Window's Here, for what it draws. */
export const HereContext = createContext<HereStore>(new Store(NOWHERE))

/**
 * `select` of Here, drawn again only as what it selects changes, as
 * `equal` tells, by default when it is another value: a widget that reads
 * the Project is not drawn again as the focus moves within it. Each part
 * of a Window's Here stays the same object while it says the same, so
 * `select` may give one, as `(h) => h.pane`. A `select` made once, not at
 * each drawing, spares React a read.
 */
export function useHere<T>(
  select: (here: Here) => T,
  equal?: (a: T, b: T) => boolean
): T {
  return useStore(useContext(HereContext), select, equal)
}
