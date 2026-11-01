/**
 * How the window tells its Person of a call (ADR 0011, decision 7): the
 * variants `[notify]` in `look.toml` chooses from, and Banda's defaults.
 */
import type { Chime } from "@bandaso/ui/sound"

export type NotifySettings = {
  /**
   * System notifications: `away`, when the window is not in front;
   * `always`, instead of a toast too; or `off`.
   */
  system: "away" | "always" | "off"
  /**
   * Toasts in the window: `out-of-sight`, for a thing whose Pane is not
   * on screen; `always`, for one on screen too; or `off`.
   */
  window: "out-of-sight" | "always" | "off"
  /** What the thing said, in the words; without it, only its title. */
  detail: boolean
  /**
   * `desktop`: nothing but the Marks while the desktop's Do Not Disturb is
   * on; `never`: Banda tells its Person regardless.
   */
  quiet: "desktop" | "never"
} & Record<Chime, boolean>

export const DEFAULT_NOTIFY: NotifySettings = {
  system: "away",
  window: "out-of-sight",
  detail: true,
  quiet: "desktop",
  done: true,
  asking: true,
  failed: true,
}
