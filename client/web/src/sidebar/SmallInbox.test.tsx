// @vitest-environment happy-dom
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import type { Look } from "@banda/contract/look"
import { DEFAULT_SIDEBAR } from "@banda/contract/sidebar"
import { type Here, HereContext, type Run, RunContext } from "@banda/core/react"
import { Store } from "@banda/core/react"
import { takeLook } from "@banda/ui/lib/look"
import { MINUTE } from "@banda/ui/lib/words"
import type { Listed, Lists } from "@banda/ui/pane"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { newStores, StoresContext } from "../calls/stores"
import { ThreadMenus } from "../titles/ThreadMenu"
import { countsWidget } from "./Counts"

// The title reads the window's naming store, which a test has none of.
vi.mock("@banda/ui/lib/naming", () => ({
  THINKING: "Naming…",
  useThinking: () => false,
  useNaming: () => null,
}))

let unmount: (() => void) | undefined

afterEach(() => {
  act(() => unmount?.())
  unmount = undefined
  vi.useRealTimers()
  document.body.replaceChildren()
})

/** Tuesday, 10 November 2026, 15:00 by the local clock. */
const NOW = new Date(2026, 10, 10, 15, 0).getTime()

const project = (id: string): ProjectSummary => ({
  id,
  name: id,
  folder: `/${id}`,
  pinned: false,
  archived: false,
  sees_others: false,
  sign: { kind: "letters", text: id[0]!.toUpperCase(), picked: false },
  trusted: true,
  scratch: false,
  missing: false,
})

const one = (id: string, more: Partial<Listed> = {}): Listed => ({
  id,
  title: id,
  mark: "done",
  changed: NOW - 14 * MINUTE,
  harness: "claude",
  by: "Claude Code",
  pane: { kind: "agents.thread", args: { thread: id } },
  ...more,
})

/** Two calls, the older done, the newer asking; one at work; one open and
 * seen, and one put off: neither counts. */
const lists: Lists = {
  ["work" as ProjectId]: [
    one("Sidebar for arc", { calls: "The rows are cards now" }),
    one("Move the settings", {
      mark: "asking",
      changed: NOW - 3 * MINUTE,
      calls: "Keep the old keys?",
    }),
    one("Bench window tests", { mark: "working", began: NOW - 2 * MINUTE }),
    one("Read the logs", { mark: "idle", seen: true }),
    one("Later on", { later: { until: NOW + 60 * MINUTE, at: NOW } }),
  ],
}

/** The counts of `lists` in the Bar's middle at `NOW`, the sidebar shown
 * or not; what they run goes to `run`. */
async function draw(
  lists: Lists,
  { sidebar = false, run = () => undefined }: { sidebar?: boolean; run?: Run }
) {
  const flags = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  flags.IS_REACT_ACT_ENVIRONMENT = true
  // The cards' times count from NOW; the popover's timers run as ever.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  const stores = newStores(NOW)
  stores.items.set(lists)
  const here = new Store<Here>({
    front: true,
    sidebar,
    workspace: null,
    pane: null,
    project: "work" as ProjectId,
    starts: "work" as ProjectId,
  })
  // An engine that never answers: the cards ask it for their Harnesses.
  const engine = {
    watch: () => () => undefined,
    call: () => new Promise(() => undefined),
  } as unknown as Engine
  const root = createRoot(
    document.body.appendChild(document.createElement("div"))
  )
  unmount = () => root.unmount()
  await act(async () =>
    root.render(
      <StoresContext value={stores}>
        <HereContext value={here}>
          <RunContext value={run}>
            <ThreadMenus engine={engine} projects={[project("work")]}>
              <button type="button">Pane</button>
              <countsWidget.Widget
                engine={engine}
                projects={[project("work")]}
              />
            </ThreadMenus>
          </RunContext>
        </HereContext>
      </StoresContext>
    )
  )
  return { here }
}

const count = () =>
  document.querySelector<HTMLButtonElement>('button[title$="at work"]')
const inbox = () =>
  document.querySelector<HTMLElement>('[role="dialog"][aria-label="Inbox"]')

test("the counts name each count and stand while the sidebar is hidden; while it shows they are not there, or, shown always, give the sidebar's Inbox the focus", async () => {
  await draw(lists, {})
  expect(count()!.getAttribute("aria-label")).toBe(
    "1 ask you · 1 done · 1 at work"
  )
  act(() => unmount?.())

  await draw(lists, { sidebar: true })
  expect(count()).toBeNull()
  act(() => unmount?.())

  // `show = "always"`: the sidebar's list is the one list.
  const bar = { ...DEFAULT_SIDEBAR.bar, show: "always" as const }
  takeLook({ sidebar: { ...DEFAULT_SIDEBAR, bar } } as unknown as Look)
  const run = vi.fn<Run>()
  await draw(lists, { sidebar: true, run })
  await act(async () => count()!.click())
  expect(run).toHaveBeenCalledWith("sidebar.show", { tab: "inbox" })
  expect(inbox()).toBeNull()
  takeLook({ sidebar: DEFAULT_SIDEBAR } as unknown as Look)
})

test("a click on the counts opens the small inbox: Your turn alone in the sidebar's cards, in the sidebar's scope, the focus on the first card; \"1 at work ›\" shows the sidebar on Working; Esc gives the focus back", async () => {
  const run = vi.fn<Run>()
  const { here } = await draw(lists, { run })
  const pane = document.querySelector<HTMLButtonElement>("button")!
  pane.focus()
  await act(async () => {
    count()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    count()!.click()
  })
  // The list loads as the small inbox first opens.
  await act(async () => {
    await import("./SmallList")
  })
  const dialog = inbox()!
  expect(dialog).not.toBeNull()
  expect(dialog.hasAttribute("data-small-inbox")).toBe(true)
  // The sidebar's list, in its scope: no tabs, no Search.
  const list = dialog.querySelector<HTMLElement>('[role="listbox"]')!
  expect(list.closest('[data-scope="sidebar"]')).not.toBeNull()
  expect(dialog.querySelector('[role="tab"]')).toBeNull()
  expect(dialog.querySelector('[role="combobox"]')).toBeNull()
  // Your turn alone, oldest first.
  const cards = [...list.querySelectorAll<HTMLElement>('[role="option"]')]
  expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
    "Sidebar for arc, Done, 14 minutes",
    "Move the settings, Asks, 3 minutes",
  ])
  // The focus is on the list, its first card picked.
  expect(document.activeElement).toBe(list)
  expect(list.getAttribute("aria-activedescendant")).toBe(cards[0]!.id)

  // Esc gives the focus back where it was.
  await act(async () => {
    list.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    )
  })
  expect(document.activeElement).toBe(pane)

  // Again: "1 at work ›" shows the sidebar on Working.
  await act(async () => count()!.click())
  const working = [...inbox()!.querySelectorAll("button")].find(
    (button) => button.textContent === "1 at work ›"
  )!
  await act(async () => working.click())
  expect(run).toHaveBeenCalledWith("sidebar.show", { tab: "working" })
  // Shown, the sidebar takes the counts and the small inbox away.
  await act(async () => here.set({ ...here.get(), sidebar: true }))
  expect(count()).toBeNull()
  expect(inbox()).toBeNull()
})
