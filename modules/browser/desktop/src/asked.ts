/**
 * What the browser's part in main answers its engine part (ADR 0029): the
 * browser's tools for Agents ask the window, which holds the pages.
 */
import type {
  Act,
  Navigate,
  OneTab,
  Open,
  WaitFor,
} from "@banda/contract/browser"
import type { Asked } from "@banda/desktop-kit"
import { Effect } from "effect"
import { Cdp } from "./cdp"
import { Drive, seenTab } from "./drive"
import { Tabs } from "./tabs"

export const browserAsked: Asked<Tabs | Cdp | Drive> = {
  /** Every tab, the Person's too (decision 1); its ID is its page's, for
   * as long as Banda runs. */
  tabs: () =>
    Effect.gen(function* () {
      const tabs = yield* Tabs
      const cdp = yield* Cdp
      return tabs.all().map((page) => seenTab(page, cdp))
    }),
  /** A tab's tree, for `browser_snapshot`; the engine checked its
   * params. */
  snapshot: (request) =>
    Drive.use((drive) => drive.snapshot((request.params as OneTab).tab)),
  /** A new tab, for `browser_open`: in the Pane in front, as one the CDP
   * endpoint opens, until a Thread's tab opens beside it (step 4). */
  open: (request) =>
    Drive.use((drive) => drive.open((request.params as Open).url)),
  /** A tab to an address, back, forward or again, for
   * `browser_navigate`; the engine checked the address. */
  navigate: (request) =>
    Drive.use((drive) => drive.navigate(request.params as Navigate)),
  /** One action on a ref, for `browser_act`; the engine checked that it
   * has what it needs. */
  act: (request) => Drive.use((drive) => drive.act(request.params as Act)),
  /** A wait, for `browser_wait_for`; the engine held it to a minute. */
  wait_for: (request) =>
    Drive.use((drive) => drive.waitFor(request.params as WaitFor)),
}
