/**
 * One core and one React across the packages (ADR 0089): what the Window
 * gives through `@banda/core/react` is what an App's part reads, by the
 * path its own package takes to it, and an App's widget draws on the
 * page's React. Two copies of the core would leave an App the defaults, no
 * run, Here nowhere and no machines but its own; two of React would throw
 * at an App's first hook. So with the kit, which gives the Apps what they
 * list, as the Window keeps it, until B7a: two copies would leave a
 * Thread's header no Mark.
 */
import { createRequire } from "node:module"
import { join } from "node:path"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import type * as CoreReact from "@banda/core/react"
import {
  type Here,
  type Machine,
  MachinesContext,
  type Run,
  Store,
} from "@banda/core/react"
import { ThreadMark } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import type { Filler } from "@banda/ui/slots"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { newStores } from "./calls/stores"
import { widgets } from "./registry"
import { Kept } from "./window/here"

const root = join(import.meta.dirname, "../../..")

/** What `specifier` gives, as the package in `folder` imports it. */
async function asIn(folder: string, specifier: string) {
  const resolve = createRequire(join(root, folder, "package.json")).resolve
  return (await import(resolve(specifier))) as typeof CoreReact
}

const here = new Store<Here>({
  front: true,
  sidebar: true,
  workspace: { id: "w1", project: "p1" },
  pane: { id: "pane1", project: "p1", subject: "t1" },
  project: "p1",
})

test("an App's part reads the run and Here the Window gives, by the path its package takes to them", async () => {
  // As the servers' widget and the bell take the run, and the Threads'
  // tests Here: from `@banda/core/react`, by their own packages' paths.
  const servers = await asIn("apps/terminal/pane", "@banda/core/react")
  const bell = await asIn("platform/notifications/pane", "@banda/core/react")
  const threads = await asIn("apps/agents/pane", "@banda/core/react")
  const ran: string[] = []
  const run: Run = (action) => void ran.push(action)
  function Reads() {
    servers.useRun()("servers.ran")
    bell.useRun()("bell.ran")
    return <>{threads.useHere((h) => h.pane?.subject)}</>
  }
  expect(
    renderToStaticMarkup(
      <Kept stores={newStores()} here={here} run={run}>
        <Reads />
      </Kept>
    )
  ).toBe("t1")
  expect(ran).toEqual(["servers.ran", "bell.ran"])
})

test("an App's widget draws on the page's React, under the Window's", () => {
  const ports = widgets.get("terminal.ports")
  expect(ports).toBeDefined()
  const { Widget } = ports!.widget
  // With no Project it draws nothing, past its hooks.
  const engine = {} as Engine
  expect(
    renderToStaticMarkup(
      <Kept stores={newStores()} here={here} run={() => undefined}>
        <Widget engine={engine} projects={[]} />
      </Kept>
    )
  ).toBe("")
})

test("a new Thread's picker lists the machines the Window gives, by the path its package takes to them", async () => {
  // As `App.tsx` gives them, from the page's `@banda/core/react`; the
  // picker reads them from the Threads package's.
  const { NewThreadBar } = (await import(
    join(root, "apps/agents/pane/src/composer/NewThread.tsx")
  )) as {
    NewThreadBar: (props: {
      engine: Engine
      project: ProjectId
      host: string | undefined
      disabled: boolean
      onProject: () => void
    }) => ReactNode
  }
  const project = (id: string): ProjectSummary => ({
    id: id as ProjectId,
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
  const machines: Machine[] = [
    { machine: "m0" as ProjectId, state: "live", projects: [project("work")] },
    {
      host: "arc",
      named: { name: "Studio", icon: "server" },
      machine: "m1" as ProjectId,
      state: "live",
      projects: [project("r1")],
    },
  ]
  // A Pane on arc, which its engine has not welcomed yet: the picker names
  // the machine as the Window does, not by its key.
  const drawn = renderToStaticMarkup(
    <MachinesContext value={machines}>
      <NewThreadBar
        engine={{} as Engine}
        project={"r1" as ProjectId}
        host="arc"
        disabled={false}
        onProject={() => undefined}
      />
    </MachinesContext>
  )
  expect(drawn).toContain("on Studio")
  expect(drawn).not.toContain("on arc")
})

test("Threads' part of a Pane's header finds its Thread among what the Apps list, as the Window gives it, by the path its package takes to the kit", async () => {
  // As the Tiling draws the Slot `pane.header` under the Window's `Kept`;
  // the filler reads the items from the Threads package's kit.
  const { threadHeader } = (await import(
    join(root, "apps/agents/pane/src/list/header.tsx")
  )) as { threadHeader: Filler<"pane.header"> }
  const { Fill } = threadHeader
  const listed: Listed = {
    id: "t1",
    title: "Hello",
    mark: "done",
    changed: 1,
    pane: { kind: "agents.thread", args: { thread: "t1" } },
  }
  const stores = newStores()
  stores.items.set({ ["p1" as ProjectId]: [listed] })
  const markup = (node: ReactNode) =>
    renderToStaticMarkup(node).replace(/banda-mark-[\w-]+/g, "banda-mark-id")
  expect(
    markup(
      <Kept stores={stores} here={here} run={() => undefined}>
        <Fill project={"p1" as ProjectId} pane={listed.pane} at="start" />
      </Kept>
    )
  ).toBe(markup(<ThreadMark listed={listed} />))
})
