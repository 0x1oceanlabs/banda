// @vitest-environment happy-dom
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { type Here, HereContext, type Run, RunContext } from "@banda/core/react"
import { Store } from "@banda/core/react"
import { MINUTE } from "@banda/ui/lib/words"
import type { Listed, Lists } from "@banda/ui/pane"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { newStores, StoresContext } from "../calls/stores"
import { ThreadMenus } from "../titles/ThreadMenu"
import {
  countOf,
  countWords,
  logoName,
  logoWords,
  NO_COUNT,
  turnTone,
} from "./count"
import { SmallInbox } from "./SmallInbox"

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

test("the count says whose turn it is and who works, and what is put away counts as neither", () => {
  expect(countOf(lists, NOW)).toEqual({ turn: 2, mark: "asking", working: 1 })
  expect(countOf({}, NOW)).toEqual(NO_COUNT)
  expect(countWords({ turn: 3, mark: "done", working: 7 })).toBe(
    "3 your turn, 7 at work"
  )
  expect(countWords({ turn: 3, mark: "done", working: 0 })).toBe("3 your turn")
  expect(countWords({ turn: 0, mark: "rest", working: 7 })).toBe("7 at work")
  // Your turn takes its loudest call's colour; woke's darker as text.
  expect(turnTone("asking")).toBe("text-attention")
  expect(turnTone("failed")).toBe("text-destructive")
  expect(turnTone("woke")).toBe("text-woke-text")
  expect(turnTone("rest")).toBe("text-foreground")
})

test('the logo is named "Banda: 3 your turn, 7 at work", with what it shows that the count does not say, and "Quiet on" while Quiet is on', () => {
  const count = { turn: 3, mark: "done" as const, working: 7 }
  const name = (...args: Parameters<typeof logoWords>) =>
    logoName(logoWords(...args))
  expect(name("done", count, false)).toBe("Banda: Done, 3 your turn, 7 at work")
  expect(name("working", { ...count, turn: 0 }, false)).toBe("Banda: 7 at work")
  expect(name("rest", NO_COUNT, true)).toBe("Banda: Quiet on")
  expect(name("offline", NO_COUNT, false)).toBe("Banda: Offline")
  // Another machine away while its Agents were at work says which.
  expect(name("offline", count, false, "arc is away with Agents at work")).toBe(
    "Banda: arc is away with Agents at work, 3 your turn, 7 at work"
  )
  expect(name("rest", NO_COUNT, false)).toBe("Banda")
})

/** The count of `lists` beside the logo at `NOW`, the sidebar shown or
 * not; what it runs goes to `run`. */
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
              <SmallInbox engine={engine} count={countOf(lists, NOW)} />
            </ThreadMenus>
          </RunContext>
        </HereContext>
      </StoresContext>
    )
  )
  return { here }
}

const count = () =>
  document.querySelector<HTMLButtonElement>("[data-inbox-count]")
const inbox = () =>
  document.querySelector<HTMLElement>('[role="dialog"][aria-label="Inbox"]')

test('the count reads "2 · 1", the turn in its loudest call\'s colour and the working in grey; nothing when nothing calls, nor while the sidebar shows', async () => {
  await draw(lists, {})
  const button = count()!
  expect(button.getAttribute("aria-label")).toBe(
    "Inbox: 2 your turn, 1 at work"
  )
  expect(button.textContent).toBe("2·1")
  const [turn, , working] = button.querySelectorAll("span")
  expect(turn!.className).toBe("text-attention")
  expect(working!.className).toBe("text-muted-foreground")
  act(() => unmount?.())

  // Only work: nothing calls, so nothing shows.
  await draw({ ["work" as ProjectId]: [lists["work" as ProjectId]![2]!] }, {})
  expect(count()).toBeNull()
  act(() => unmount?.())

  await draw(lists, { sidebar: true })
  expect(count()).toBeNull()
})

test('a click opens the small inbox: Your turn alone in one-line cards, in the sidebar\'s scope, the focus on the first card; "1 at work ›" shows the sidebar on Working; Esc gives the focus back', async () => {
  const run = vi.fn<Run>()
  const { here } = await draw(lists, { run })
  const pane = document.querySelector<HTMLButtonElement>("button")!
  pane.focus()
  await act(async () => {
    count()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    count()!.click()
  })
  const dialog = inbox()!
  expect(dialog).not.toBeNull()
  expect(dialog.hasAttribute("data-small-inbox")).toBe(true)
  // The sidebar's list, in its scope: no tabs, no Search.
  const list = dialog.querySelector<HTMLElement>('[role="listbox"]')!
  expect(list.closest('[data-scope="sidebar"]')).not.toBeNull()
  expect(dialog.querySelector('[role="tab"]')).toBeNull()
  expect(dialog.querySelector('[role="combobox"]')).toBeNull()
  // Your turn alone, oldest first, each card one line.
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
  // Shown, the sidebar takes the count and the small inbox away.
  await act(async () => here.set({ ...here.get(), sidebar: true }))
  expect(count()).toBeNull()
  expect(inbox()).toBeNull()
})
