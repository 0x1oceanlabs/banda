import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import type { HarnessView } from "@banda/contract/harnesses"
import {
  type Here,
  HereContext,
  type Machine,
  MachinesContext,
  Store,
} from "@banda/core/react"
import { DEFAULT_KEYS } from "@banda/contract/look"
import { KeysInForce } from "@banda/ui/hooks/use-key-of"
import { type Key, keyLabel } from "@banda/ui/lib/keys"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import {
  inParts,
  NewThreadMenu,
  onPicks,
  startOf,
  withPicks,
} from "./NewThreadMenu"
import { clickOf, NEW_THREAD } from "./open"

/** Project `id`, as an engine lists it, with `more`. */
const project = (
  id: string,
  more: Partial<ProjectSummary> = {}
): ProjectSummary => ({
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
  ...more,
})

/** This machine: banda and Work, its No Project `here`. */
const ours: Machine = {
  machine: "here",
  state: "live",
  projects: [project("banda"), project("Work")],
}

/** arc, live: banda.so, its No Project `arc-none`. */
const arc: Machine = {
  host: "arc",
  named: { name: "arc", icon: "server" },
  machine: "arc-none",
  state: "live",
  projects: [project("banda.so")],
}

/** mac, away, whose engine never named its No Project. */
const mac: Machine = {
  host: "mac",
  named: { name: "mac", icon: "laptop" },
  state: "away",
  away: 1,
  projects: [],
}

const machines = [ours, arc, mac]

test("a click starts where Alt+Enter does", () => {
  const listed = [project("Work"), project("lab", { missing: true })]
  expect(clickOf("Work", listed)).toEqual({ project: "Work" })
  // One whose folder is missing is found first.
  expect(clickOf("lab", listed)).toEqual({ project: "lab", missing: true })
})

test("a click's Project is on the machine that lists it, this one first", () => {
  expect(startOf({ project: "Work" }, machines)).toEqual({ project: "Work" })
  expect(startOf({ project: "banda.so" }, machines)).toEqual({
    project: "banda.so",
    host: "arc",
  })
  // A machine's No Project is one of the picks too.
  expect(startOf({ project: "arc-none" }, machines)).toEqual({
    project: "arc-none",
    host: "arc",
  })
  // An ID two machines list is this one's, as Hosts.hostOf finds it.
  const twice = [{ ...ours, projects: [project("banda.so")] }, arc]
  expect(startOf({ project: "banda.so" }, twice)).toEqual({
    project: "banda.so",
  })
})

test("a Project no machine lists is this one's, unticked, and one whose folder is missing is found first", () => {
  // A Project picked in the list whose folder went: no pick offers it.
  expect(startOf({ project: "gone", missing: true }, machines)).toEqual({
    project: "gone",
    missing: true,
  })
  // With no machines known yet, outside a Window.
  expect(startOf({ project: "Work", missing: false }, undefined)).toEqual({
    project: "Work",
  })
})

test('"in" lists each machine\'s Projects, then its No Project, this machine first, and ticks what a click takes', () => {
  const parts = inParts(machines, { project: "Work" })
  // mac has nothing to start in: no part.
  expect(parts.map((part) => part.host)).toEqual([undefined, "arc"])
  const [mine, there] = parts
  expect(mine!.named).toBeUndefined()
  expect(mine!.picks.map((one) => [one.name, one.ticked])).toEqual([
    ["banda", false],
    ["Work", true],
    ["No Project", false],
  ])
  // No Project has no summary: its sign is No Project's.
  expect(mine!.picks[2]!.project).toBeUndefined()
  expect(there!.named?.name).toBe("arc")
  expect(there!.picks.map((one) => one.start)).toEqual([
    { project: "banda.so", host: "arc" },
    { project: "arc-none", host: "arc" },
  ])
  expect(there!.picks.some((one) => one.ticked)).toBe(false)
  // The same Project ID on another machine is not the one ticked.
  const ticked = inParts(machines, { project: "arc-none", host: "arc" })
  expect(ticked[1]!.picks[1]!.ticked).toBe(true)
  expect(ticked[0]!.picks.some((one) => one.ticked)).toBe(false)
})

test('"on" names no machine while there is one, and starts another in its No Project', () => {
  expect(onPicks([ours], { project: "Work" })).toEqual([])
  const on = onPicks(machines, { project: "Work" })
  expect(on.map((one) => [one.host, one.ticked, one.away])).toEqual([
    [undefined, true, false],
    ["arc", false, false],
    ["mac", false, true],
  ])
  // The one ticked starts where a click does.
  expect(on[0]!.start).toEqual({ project: "Work" })
  expect(on[1]!.start).toEqual({ project: "arc-none", host: "arc" })
  // Its engine never named its No Project: nothing to start in yet.
  expect(on[2]!.start).toBeUndefined()
})

test('"with" lists the Harnesses on, and ticks the first', () => {
  const harness = (id: string, enabled = true): HarnessView => ({
    id,
    name: id,
    short: id,
    enabled,
    command: [id],
    env: [],
    harness: id,
    kind: "subscription",
    mark: id[0]!.toUpperCase(),
    colour: 0,
    sessions: id,
  })
  expect(withPicks([])).toEqual({ on: [], ticked: undefined })
  const { on, ticked } = withPicks([
    harness("claude", false),
    harness("codex"),
    harness("fake"),
  ])
  expect(on.map((one) => one.id)).toEqual(["codex", "fake"])
  expect(ticked).toBe("codex")
  // Where a click starts, as Settings' default or its fallback says.
  const all = [harness("claude", false), harness("codex"), harness("fake")]
  expect(withPicks(all, "fake").ticked).toBe("fake")
  expect(withPicks(all, "gone").ticked).toBe("codex")
})

test("✎ names its key in force and its menu, which is shut until asked for", () => {
  // Alt+Enter, as Banda's own key for a new Thread is today.
  const key: Key = { code: "Enter", alt: true }
  const here = new Store<Here>({
    front: true,
    sidebar: true,
    workspace: null,
    pane: null,
    project: "Work" as ProjectId,
    starts: "Work" as ProjectId,
  })
  const html = renderToStaticMarkup(
    <KeysInForce
      value={{
        mod: DEFAULT_KEYS.mod,
        byAction: new Map([[NEW_THREAD, key]]),
        byScope: new Map(),
      }}
    >
      <HereContext value={here}>
        <MachinesContext value={machines}>
          <NewThreadMenu engine={{} as Engine} projects={ours.projects} />
        </MachinesContext>
      </HereContext>
    </KeysInForce>
  )
  expect(html).toContain('aria-label="New Thread"')
  expect(html).toContain(`title="New Thread (${keyLabel(key)})"`)
  expect(html).toContain('aria-haspopup="menu"')
  expect(html).toContain('aria-expanded="false"')
  expect(html).not.toContain('role="menu"')
})
