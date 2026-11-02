/**
 * What the browser's part in main answers its engine part (ADR 0029): the
 * browser's tools for Agents ask the window, which holds the pages.
 */
import type { OneTab, SeenTab } from "@banda/contract/browser"
import type { Asked } from "@banda/desktop-kit"
import { Effect } from "effect"
import { Cdp } from "./cdp"
import { Drive } from "./drive"
import { Tabs } from "./tabs"

export const browserAsked: Asked<Tabs | Cdp | Drive> = {
  /** Every tab, the Person's too (decision 1); its ID is its page's, for
   * as long as Banda runs. */
  tabs: () =>
    Effect.gen(function* () {
      const tabs = yield* Tabs
      const cdp = yield* Cdp
      return tabs.all().map((page): SeenTab => ({
        id: page.id,
        url: page.getURL(),
        title: page.getTitle(),
        driven: cdp.drives(page),
      }))
    }),
  /** A tab's tree, for `browser_snapshot`; the engine checked its
   * params. */
  snapshot: (request) =>
    Drive.use((drive) => drive.snapshot((request.params as OneTab).tab)),
}
