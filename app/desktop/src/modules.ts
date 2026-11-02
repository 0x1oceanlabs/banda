/**
 * The modules' parts in the window's main process (ADR 0028, decision 4):
 * the one file in main that names a module, as `app/web/src/modules.ts`
 * is in the page. Main builds its runtime with their layer, answers the
 * bridge's channels with their answers and what their engine parts ask
 * with `asked` (road.ts), serves their hosts of `app://` with `served`,
 * and tells them when its window opens.
 */
import { agentsDesktop } from "@banda/agents-desktop"
import { browserDesktop } from "@banda/browser-desktop"
import type { Asked, DesktopModule } from "@banda/desktop-kit"
import { Layer } from "effect"

/** What a module's part uses: its own services and what main gives it. */
type Uses<M> =
  M extends DesktopModule<object, infer Services, infer Needs>
    ? Services | Needs
    : never

/** Under the module's name, as its engine part asks. */
const asked: Readonly<
  Record<string, Asked<Uses<typeof browserDesktop | typeof agentsDesktop>>>
> = { browser: browserDesktop.asked, agents: agentsDesktop.asked }

export const modules = {
  layer: Layer.mergeAll(browserDesktop.layer, agentsDesktop.layer),
  /** Under where the bridge's table takes each module in. */
  answers: { browser: browserDesktop.answers },
  asked,
  /** By the host of `app://` each serves. */
  served: agentsDesktop.served,
  opened: browserDesktop.opened,
}
