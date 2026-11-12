import type { ProjectId, ProjectSummary } from "@banda/contract"
import { type Here, Store } from "@banda/core"
import { HereContext, RunContext } from "@banda/core/react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { useNewThread } from "./open"

const IN_FRONT = "in-front" as ProjectId

const project = (id: ProjectId, missing = false) =>
  ({ id, name: id, missing }) as ProjectSummary

/** What pressing the sidebar's New Thread runs. */
function pressed(projects: ProjectSummary[]) {
  const ran: unknown[] = []
  let press = () => {}
  function Button() {
    press = useNewThread(projects)
    return null
  }
  const here = new Store({ starts: IN_FRONT } as Here)
  renderToStaticMarkup(
    <RunContext value={(action, args) => void ran.push([action, args])}>
      <HereContext value={here}>
        <Button />
      </HereContext>
    </RunContext>
  )
  press()
  return ran
}

test("New Thread starts in the Project in front, as Alt+Enter does", () => {
  expect(pressed([])).toEqual([["thread.new", { project: IN_FRONT }]])
})

test("one whose folder is missing still asks to be located", () => {
  expect(pressed([project(IN_FRONT, true)])).toEqual([
    ["projects.locate", { project: IN_FRONT }],
  ])
})
