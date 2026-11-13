/**
 * The modules' parts in the window's main process (ADR 0028, decision 4):
 * the one file in main that names a module, as `client/web/src/modules.ts`
 * is in the page. Main builds its runtime with their layer, answers the
 * bridge's channels with their answers and what their engine parts ask
 * with `asked` (road.ts), serves their hosts of `app://` with `served`,
 * and tells them when its window opens. The keys module has no part of
 * its own here: what it asks, an action to run, the window's own road to
 * its page answers (acts.ts).
 */
import { agentsDesktop } from "@banda/agents-desktop"
import { browserDesktop } from "@banda/browser-desktop"
import { notificationsDesktop } from "@banda/notifications-desktop"
import { followEngine, updates } from "@banda/updates-desktop"
import type { Asked, DesktopModule } from "@banda/desktop-kit"
import { Layer } from "effect"
import { Acts, actsAsked } from "./acts"

/** What a module's part uses: its own services and what main gives it. */
type Uses<M> =
  M extends DesktopModule<object, infer Services, infer Needs>
    ? Services | Needs
    : never

/** Under the module's name, as its engine part asks. */
const asked: Readonly<
  Record<
    string,
    Asked<
      | Uses<
          | typeof browserDesktop
          | typeof agentsDesktop
          | typeof notificationsDesktop
        >
      | Acts
    >
  >
> = {
  browser: browserDesktop.asked,
  agents: agentsDesktop.asked,
  keys: actsAsked,
}

export const modules = {
  layer: Layer.mergeAll(
    browserDesktop.layer,
    notificationsDesktop.layer,
    Acts.layer
  ),
  /** Under where the bridge's table takes each module in. */
  answers: {
    browser: browserDesktop.answers,
    notifications: notificationsDesktop.answers,
  },
  asked,
  /** By the host of `app://` each serves. */
  served: agentsDesktop.served,
  opened: browserDesktop.opened,
}

/** The updates module's part (ADR 0119, decision 2): the swap of the
 * window's own app, which main wires to the bridge's `update` and to its
 * engine's `updates.state`. */
export const appUpdates = { updates, followEngine }
