import { vi } from "vitest"
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")
  return { ipcMain: new EventEmitter(), webContents: { fromId: () => null } }
})
import { expect, it } from "@effect/vitest"
import type { Participant, WindowRequest } from "@banda/contract"
import type { Shown } from "@banda/contract/browser"
import { Refused } from "@banda/desktop-kit"
import { Effect, Layer, Stream } from "effect"
import type { WebContents } from "electron"
import { browserAsked } from "./asked"
import { Cdp } from "./cdp"
import { Drive } from "./drive"
import { Tabs } from "./tabs"

const work = "0199a3c4-0000-7000-8000-000000000001"
const agent: Participant = { kind: "agent", id: "agent-1" }

/** A tab's page, as the tools list it. */
const page = (id: number) =>
  ({
    id,
    getURL: () => `https://example.com/${id}`,
    getTitle: () => `Tab ${id}`,
  }) as unknown as WebContents

/** A tab the Agents of `work` opened, and one of the Person's. */
const ours = page(1)
const mine = page(2)

/** What the fake hands were asked to do, by name. */
const done: string[] = []

const shown = (tab: number, opened: number[] = []): Shown => ({
  tab,
  url: `https://example.com/${tab}`,
  title: `Tab ${tab}`,
  loading: false,
  moved: false,
  opened: opened.map((id) => ({
    id,
    url: `https://example.com/${id}`,
    title: `Tab ${id}`,
    driven: false,
  })),
  dialog: null,
  download: null,
  touched: false,
})

type Hands = Drive["Service"]

/** Hands that do what they are asked, and note it; `refused` refuses
 * every call as tools switched off do. */
const hands = (refused = false) => {
  const some: Pick<Hands, "access" | "snapshot" | "act" | "open"> = {
    access: () =>
      refused
        ? Effect.fail(new Refused({ code: "forbidden", message: "Off." }))
        : Effect.void,
    snapshot: (tab) =>
      Effect.sync(() => {
        done.push(`snapshot ${tab}`)
        return { url: "", title: "", tree: "", errors: [], dialog: null }
      }),
    act: (act) =>
      Effect.sync(() => {
        done.push(`act ${act.tab}`)
        // It opened a tab of its own profile, and the Person one meanwhile.
        return shown(act.tab, [3, mine.id])
      }),
    open: (_url, _by, project) =>
      Effect.sync(() => {
        done.push(`open in ${project}`)
        return shown(3)
      }),
  }
  // Any other call is one the test did not expect to reach the hands.
  const other = () => Effect.sync(() => void done.push("other"))
  return Layer.succeed(Drive)(
    new Proxy(some, {
      get: (target, name) =>
        name in target ? target[name as keyof typeof target] : other,
    }) as Hands
  )
}

const layer = (refused = false) =>
  Layer.mergeAll(
    hands(refused),
    Layer.succeed(Tabs)({
      all: () => [ours, mine, page(3)],
      changes: Stream.never,
      attached: () => {},
      profiled: () => {},
      whose: () => undefined,
      // The Agents of `work` opened tabs 1 and 3.
      seen: (project) => (project === work ? [ours, page(3)] : []),
      create: () => Effect.never,
      created: () => Effect.void,
      tell: () => {},
    }),
    Layer.succeed(Cdp)({
      stop: () => Effect.void,
      drives: () => false,
      tab: () => undefined,
    })
  )

/** What the window answers the Agent's call `method` with `params`. */
const asked = (method: string, params: object) =>
  browserAsked[method]!({
    id: 1,
    method: `browser.${method}`,
    project: work,
    by: agent,
    params: params as WindowRequest["params"],
    within: 1000,
  }).pipe(Effect.result)

it.effect("an Agent lists and drives only the tabs in its reach", () =>
  Effect.gen(function* () {
    done.length = 0
    const listed = yield* asked("tabs", {})
    expect(listed._tag === "Success" && listed.success).toEqual([
      { id: 1, url: "https://example.com/1", title: "Tab 1", driven: false },
      { id: 3, url: "https://example.com/3", title: "Tab 3", driven: false },
    ])

    // A tab outside its reach is refused as one there is not, and nothing
    // is done there: the Person's, or one that never was.
    for (const [method, params] of [
      ["snapshot", { tab: mine.id }],
      ["screenshot", { tab: mine.id }],
      ["navigate", { tab: mine.id, to: "reload" }],
      ["act", { tab: mine.id, action: "click", ref: "e1" }],
      ["wait_for", { tab: mine.id, text: "Hi" }],
      ["handoff", { tab: mine.id, why: "Sign in" }],
      ["snapshot", { tab: 99 }],
    ] as const) {
      const refused = yield* asked(method, params)
      expect(refused._tag, method).toBe("Failure")
      if (refused._tag === "Failure")
        expect(refused.failure).toMatchObject({
          code: "not_found",
          message: `There is no tab ${params.tab}: browser_tabs lists them.`,
        })
    }
    // Nor is one that names no tab.
    const unnamed = yield* asked("snapshot", {})
    expect(unnamed._tag === "Failure" && unnamed.failure.code).toBe("invalid")
    expect(done).toEqual([])

    // A tab in its reach is driven; what an action opened is said only
    // when in its reach too.
    expect((yield* asked("snapshot", { tab: ours.id }))._tag).toBe("Success")
    const acted = yield* asked("act", { tab: ours.id, action: "click" })
    expect(
      acted._tag === "Success" &&
        (acted.success as Shown).opened.map((t) => t.id)
    ).toEqual([3])
    // A tab it opens is its Project's Agents'.
    expect((yield* asked("open", {}))._tag).toBe("Success")
    expect(done).toEqual(["snapshot 1", "act 1", `open in ${work}`])
  }).pipe(Effect.provide(layer()))
)

it.effect("tools switched off refuse before the tab is looked for", () =>
  Effect.gen(function* () {
    const refused = yield* asked("snapshot", { tab: mine.id })
    expect(refused._tag === "Failure" && refused.failure.message).toBe("Off.")
  }).pipe(Effect.provide(layer(true)))
)
