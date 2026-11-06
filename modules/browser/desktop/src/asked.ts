/**
 * What the browser's part in main answers its engine part (ADR 0029): the
 * browser's tools for Agents ask the window, which holds the pages.
 *
 * Each request names the Project of the call and who made it. A call sees
 * and drives only the tabs in its reach (`Tabs.seen`, ADR 0083, decision
 * 4): it lists no other, and one it names outside its reach is refused as
 * a tab there is not.
 */
import type {
  Act,
  Handoff,
  Navigate,
  OneTab,
  Open,
  WaitFor,
} from "@banda/contract/browser"
import type { WindowRequest } from "@banda/contract"
import { type Asked, Refused } from "@banda/desktop-kit"
import { Effect } from "effect"
import { Cdp } from "./cdp"
import { Drive, seenTab } from "./drive"
import { noTab, Tabs } from "./tabs"

/** Who asks: the Agent of a Thread, as a rule. */
const byOf = (request: WindowRequest) => request.by

/** The IDs of the tabs in the reach of `request`'s call. */
const reachOf = (request: WindowRequest) =>
  Tabs.use((tabs) =>
    Effect.sync(
      () =>
        new Set(tabs.seen(request.project, request.by).map((page) => page.id))
    )
  )

/** The tab a request names, if it names one. */
const tabOf = (request: WindowRequest): number | undefined => {
  const { params } = request
  const tab =
    typeof params === "object" && params !== null && !Array.isArray(params)
      ? params.tab
      : undefined
  return typeof tab === "number" ? tab : undefined
}

const handlers: Asked<Tabs | Cdp | Drive> = {
  /** The tabs in the call's reach; a tab's ID is its page's, for as long
   * as Banda runs. */
  tabs: (request) =>
    Effect.gen(function* () {
      const tabs = yield* Tabs
      const cdp = yield* Cdp
      return tabs
        .seen(request.project, request.by)
        .map((page) => seenTab(page, cdp))
    }),
  /** A tab's tree, for `browser_snapshot`; the engine checked its
   * params. */
  snapshot: (request) =>
    Drive.use((drive) =>
      drive.snapshot((request.params as OneTab).tab, byOf(request))
    ),
  screenshot: (request) =>
    Drive.use((drive) =>
      drive.screenshot((request.params as OneTab).tab, byOf(request))
    ),
  /** A new tab, for `browser_open`, beside the asking Agent's Thread
   * (decision 4), in its Project's Agents' profile. */
  open: (request) =>
    Drive.use((drive) =>
      drive.open((request.params as Open).url, byOf(request), request.project)
    ),
  /** A tab to an address, back, forward or again, for
   * `browser_navigate`; the engine checked the address. */
  navigate: (request) =>
    Drive.use((drive) =>
      drive.navigate(request.params as Navigate, byOf(request))
    ),
  /** One action on a ref, for `browser_act`; the engine checked that it
   * has what it needs. The tabs it opened are said only when in reach. */
  act: (request) =>
    Effect.gen(function* () {
      const drive = yield* Drive
      const shown = yield* drive.act(request.params as Act, byOf(request))
      const reach = yield* reachOf(request)
      return {
        ...shown,
        opened: shown.opened.filter((tab) => reach.has(tab.id)),
      }
    }),
  /** A wait, for `browser_wait_for`; the engine held it to a minute. */
  wait_for: (request) =>
    Drive.use((drive) =>
      drive.waitFor(request.params as WaitFor, byOf(request))
    ),
  /** A tab handed to the Person, for `browser_handoff`. */
  handoff: (request) =>
    Drive.use((drive) =>
      Effect.as(drive.handoff(request.params as Handoff, byOf(request)), null)
    ),
}

/** What is asked with no tab named; every other request names one. */
const UNTABBED = new Set(["tabs", "open"])

/** Refuses a request `name` that names no tab, or one outside its call's
 * reach, as one there is not. */
const inReach = (name: string, request: WindowRequest) =>
  Effect.gen(function* () {
    if (UNTABBED.has(name)) return
    const tab = tabOf(request)
    if (tab === undefined)
      return yield* new Refused({
        code: "invalid",
        message: "Name the tab, as browser_tabs lists it.",
      })
    if (!(yield* reachOf(request)).has(tab)) return yield* noTab(tab)
  })

/** Lists stay stable in an MCP session. The setting is enforced on each
 * request, so switching tools off also stops existing sessions; so is
 * the reach, as tabs come and go. */
export const browserAsked: Asked<Tabs | Cdp | Drive> = Object.fromEntries(
  Object.entries(handlers).map(([name, answer]) => [
    name,
    (request: WindowRequest) =>
      Drive.use((drive) => drive.access(byOf(request))).pipe(
        Effect.andThen(inReach(name, request)),
        Effect.andThen(answer(request))
      ),
  ])
)
