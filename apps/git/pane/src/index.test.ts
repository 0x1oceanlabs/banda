import type { ProjectId } from "@banda/contract"
import type { WindowApi } from "@banda/ui/module"
import { expect, test, vi } from "vitest"
import { git } from "./index"

test("the Diff opens on the Project a Pane names, and from a key leaves it to the change", () => {
  const open = vi.fn()
  const window = { open } as unknown as WindowApi
  const toggle = git.actions?.find((action) => action.id === "git.diff")
  toggle?.run(window, { project: "on-arc" as ProjectId })
  toggle?.run(window)
  expect(open.mock.calls.map(([, project]) => project as unknown)).toEqual([
    "on-arc",
    undefined,
  ])
})
