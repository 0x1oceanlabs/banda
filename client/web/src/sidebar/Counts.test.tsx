// @vitest-environment happy-dom
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import type { Look } from "@banda/contract/look"
import { DEFAULT_SIDEBAR, type Machines } from "@banda/contract/sidebar"
import {
  FORGETTING,
  HostsContext,
  KeptHosts,
  type Run,
  RunContext,
} from "@banda/core/react"
import {
  DropdownMenu,
  DropdownMenuContent,
} from "@banda/ui/components/dropdown-menu"
import { takeLook } from "@banda/ui/lib/look"
import { MINUTE } from "@banda/ui/lib/words"
import type { Listed, Lists } from "@banda/ui/pane"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { List } from "./Counts"
import { tally } from "./tally"

// The title reads the window's naming store, which a test has none of.
vi.mock("@banda/ui/lib/naming", () => ({
  THINKING: "Naming…",
  useThinking: () => false,
}))

let unmount: (() => void) | undefined
let stop: (() => void) | undefined

afterEach(() => {
  act(() => unmount?.())
  stop?.()
  unmount = stop = undefined
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

const one = (id: string, more: Partial<Listed>): Listed => ({
  id,
  title: id,
  mark: "done",
  changed: NOW - 14 * MINUTE,
  harness: "claude",
  by: "Claude Code",
  pane: { kind: "agents.thread", args: { thread: id } },
  ...more,
})

const lists: Lists = {
  ["work" as ProjectId]: [
    one("Sidebar for arc", { calls: "The rows are cards now" }),
    one("Bench window tests", { mark: "working", began: NOW - 2 * MINUTE }),
  ],
  ["far" as ProjectId]: [one("Done on arc", { changed: NOW - 3 * MINUTE })],
}

/** The counts' list of `lists` open at `NOW`, this machine, mac, holding
 * Work and arc live with far; what it runs goes to `run`. Its rows. */
async function listOf(lists: Lists, run: Run = () => undefined) {
  const flags = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  flags.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  const kept = new KeptHosts(
    {
      follow: () => undefined,
      engine: () => Promise.reject(new Error("No engine here.")),
      start: () => undefined,
    },
    {
      ...FORGETTING,
      followHere: (_, said) => {
        said({ name: "mac", icon: "laptop" })
        return () => undefined
      },
    },
    {} as Engine
  )
  stop = kept.follow()
  const build = { build: "abc", version: null }
  kept.take([{ name: "arc", ssh: "arc", state: "live", ...build, own: build }])
  kept.projects("arc", [project("far")])
  const root = createRoot(
    document.body.appendChild(document.createElement("div"))
  )
  unmount = () => root.unmount()
  await act(async () =>
    root.render(
      <RunContext value={run}>
        <HostsContext value={kept}>
          <DropdownMenu open>
            <DropdownMenuContent>
              <List
                tallies={tally(lists, ["done", "working"], NOW)}
                lists={lists}
                now={NOW}
                projects={[project("work")]}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </HostsContext>
      </RunContext>
    )
  )
  return [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
}

/** One line, the card's own: no line 2 or 3, no Project's sign; its title
 * and its time. */
function oneLine(item: Element) {
  expect(item.querySelectorAll(":scope > span")).toHaveLength(1)
  expect(item.querySelector("[data-sign]")).toBeNull()
  expect(item.querySelector("[data-slot=fade-text]")).not.toBeNull()
  expect(item.querySelector("[data-time]")).not.toBeNull()
}

test("the counts' list draws each Thread as the sidebar's one-line card: its mark, its title, another machine's icon and its time, with no Project's sign; a screen reader hears its spoken name (ADR 0098, decision 27; #1067)", async () => {
  const items = await listOf(lists)
  expect(items.map((item) => item.getAttribute("aria-label"))).toEqual([
    "Sidebar for arc, Done, 14 minutes",
    "Done on arc, Done, 3 minutes",
    "Bench window tests, Working, 2 minutes",
  ])
  for (const item of items) oneLine(item)
  // Only arc's names its machine, by its icon.
  expect(
    items.map((item) => item.querySelector("[data-machine-icon]") !== null)
  ).toEqual([false, true, false])
  expect(items[1]!.getAttribute("aria-description")).toBe("arc")
  expect(
    items.map((item) => item.querySelector("[data-time]")!.textContent)
  ).toEqual(["14m", "3m", "2m"])
})

test("a Thread whose Project the sidebar does not know is in the list too, as many rows as the bar counts, last, the same one-line card with no Project part, and it opens its Thread", async () => {
  const run = vi.fn<Run>()
  const pane = { kind: "agents.thread", args: { thread: "Left behind" } }
  const more = { ...lists, ["gone" as ProjectId]: [one("Left behind", {})] }
  const items = await listOf(more, run)
  const counted = tally(more, ["done", "working"], NOW)
  expect(items).toHaveLength(
    counted.reduce((all, { things }) => all + things.length, 0)
  )
  expect(items.map((item) => item.getAttribute("aria-label"))).toEqual([
    "Sidebar for arc, Done, 14 minutes",
    "Done on arc, Done, 3 minutes",
    "Left behind, Done, 14 minutes",
    "Bench window tests, Working, 2 minutes",
  ])
  const left = items[2]!
  oneLine(left)
  expect(left.querySelector("[data-machine-icon]")).toBeNull()
  expect(left.querySelector("[data-slot=fade-text]")!.textContent).toBe(
    "Left behind"
  )
  await act(async () => left.click())
  expect(run).toHaveBeenCalledWith("pane.pick", { project: "gone", pane })
})

test("the counts' list names the machines as the sidebar's cards do, by `[machines]` in sidebar.toml (ADR 0095): with rows = \"off\" none, and with this-too this machine too", async () => {
  const machinesAre = (machines: Machines) =>
    takeLook({ sidebar: { ...DEFAULT_SIDEBAR, machines } } as unknown as Look)
  const icons = (items: readonly Element[]) =>
    items.map(
      (item) =>
        item
          .querySelector("[data-machine-icon]")
          ?.getAttribute("data-machine-icon") ?? null
    )
  machinesAre({ rows: "off", thisToo: false })
  expect(icons(await listOf(lists))).toEqual([null, null, null])
  act(() => unmount?.())
  machinesAre({ rows: "named", thisToo: true })
  expect(icons(await listOf(lists))).toEqual(["laptop", "desktop", "laptop"])
  takeLook({ sidebar: DEFAULT_SIDEBAR } as unknown as Look)
})
