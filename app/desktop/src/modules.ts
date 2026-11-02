/**
 * The modules' parts in the window's main process (ADR 0028, decision 4):
 * the one file in main that names a module, as `app/web/src/modules.ts`
 * is in the page. Main builds its runtime with their layer, answers the
 * bridge's channels with their answers, and tells them when its window
 * opens.
 */
import { browserDesktop } from "@banda/browser-desktop"

export const modules = {
  layer: browserDesktop.layer,
  /** Under where the bridge's table takes each module in. */
  answers: { browser: browserDesktop.answers },
  opened: browserDesktop.opened,
}
