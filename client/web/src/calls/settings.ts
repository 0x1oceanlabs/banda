/**
 * How the window tells its Person of a call (ADR 0011, decision 7): the
 * variants `[notify]` in `look.toml` chooses from (`platform/look/src/notify.rs`),
 * and Banda's defaults, which hold until the look comes.
 */
import type { Notify } from "@banda/contract/look"

export const DEFAULT_NOTIFY: Notify = {
  system: "away",
  window: "out-of-sight",
  detail: true,
  quiet: "desktop",
  done: true,
  asking: true,
  failed: true,
  problems: true,
}
