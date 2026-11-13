/**
 * What lies over what in the Window, written once (ADR 0110, step 3;
 * ADR 0113, decision 5): the lowest first. Each name is a token of Banda
 * UI, `--z-index-NAME`, and its class, `z-NAME`. Where two layers have one
 * value, the later one here is drawn later, so it lies over the other
 * (`Layered`).
 *
 * - `sidebar`: the Sidebar, over the Strip in a narrow window.
 * - `peek`: Quick Look's tile.
 * - `drawer`: the Drawer and its scrim.
 * - `sheet`: the Sheet.
 * - `top`: what Banda UI draws in the Top layer, each over the one opened
 *   before it: the Banda menu, dialogs, menus, popovers.
 * - `carried`: what the Person carries, as a Pane being moved.
 */
export const LAYERS = [
  "sidebar",
  "peek",
  "drawer",
  "sheet",
  "top",
  "carried",
] as const

export type Layer = (typeof LAYERS)[number]

/** How high `layer` lies: the higher lies over the lower. */
export function heightOf(layer: Layer): number {
  return LAYERS.indexOf(layer)
}
