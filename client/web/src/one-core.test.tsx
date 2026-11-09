/**
 * One core and one React across the packages (ADR 0089): what the Window
 * gives through `@banda/core/react` is what an App's part reads, by the
 * path its own package takes to it, and an App's widget draws on the
 * page's React. Two copies of the core would leave an App the defaults, no
 * run and Here nowhere; two of React would throw at an App's first hook.
 */
import { createRequire } from "node:module"
import { join } from "node:path"
import type { Engine } from "@banda/contract"
import type * as CoreReact from "@banda/core/react"
import { type Here, type Run, Store } from "@banda/core/react"
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
