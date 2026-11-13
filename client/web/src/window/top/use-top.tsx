import { Fragment, type ReactNode, useEffect, useLayoutEffect } from "react"
import { useSteady } from "../steady"
import { LAYERS, type Layer } from "./layers"
import { type Shown, top } from "./stack"

/**
 * Says to the stack that a part of the Top layer shows, for as long as
 * `shown`: its layer, whether it takes the keys, and how Esc takes it
 * away. Its root on the page carries its name, `data-top`. As it goes,
 * the stack gives the keys back where they were, at once: a key pressed
 * as the part fades is the window's.
 */
export function useTop(shown: boolean, { part, layer, keys, close }: Shown) {
  // One for the part's life, which closes as the latest drawing does.
  const { close: steady } = useSteady({ close })
  useLayoutEffect(() => {
    if (!shown) return
    return top.show({ part, layer, keys, ...(steady && { close: steady }) })
  }, [shown, part, layer, keys, steady])
}

/** The Window's root has the stack follow the page while it lives. */
export function useTopFollows() {
  useEffect(() => top.follow(), [])
}

/**
 * Draws the Window's own parts of the Top layer, each named by its
 * layer, the lowest first: where two layers have one value, as the Drawer
 * and the Sheet, the one drawn later lies over. So their order is the
 * layers', and no place in the Window's root.
 */
export function Layered({
  parts,
}: {
  parts: Partial<Record<Layer, ReactNode>>
}) {
  return LAYERS.map((layer) => <Fragment key={layer}>{parts[layer]}</Fragment>)
}
