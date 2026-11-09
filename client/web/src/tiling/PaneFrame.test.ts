import type { ProjectId } from "@banda/contract"
import type { PaneState } from "@banda/ui/pane"
import { expect, test, vi } from "vitest"
import { type Frame, handleOf } from "./PaneFrame"

/** A frame that notes what its Panes open and update. */
function frameOf() {
  const open = vi.fn<Frame["open"]>()
  const update = vi.fn<Frame["update"]>()
  const frame: Frame = {
    focus: () => undefined,
    open,
    update,
    close: () => undefined,
    run: () => undefined,
    arrange: () => Promise.resolve(),
  }
  return { frame, open, update }
}

const thread = (args: PaneState["args"] = {}): PaneState => ({
  kind: "agents.thread",
  args: { thread: null, ...args },
})

test("a Pane on another host opens on that host what names none, and what names its own where it names it", () => {
  const { frame, open, update } = frameOf()
  const project = "banda" as ProjectId
  const arc = handleOf(frame, "e1", project, "agents.thread", "arc")

  // What it opens in its own Project or another of arc's is arc's.
  arc.open(thread(), "instead")
  expect(open).toHaveBeenLastCalledWith(
    project,
    thread({ host: "arc" }),
    "e1",
    "instead"
  )
  // A new Thread moved to a third machine's Project opens there, not on
  // arc with devbox's Project.
  arc.open(thread({ host: "devbox" }), "instead", "d1" as ProjectId)
  expect(open).toHaveBeenLastCalledWith(
    "d1",
    thread({ host: "devbox" }),
    "e1",
    "instead"
  )
  // Its own args keep arc.
  arc.update({ thread: "t1" })
  expect(update).toHaveBeenLastCalledWith("e1", {
    kind: "agents.thread",
    args: { thread: "t1", host: "arc" },
  })

  // This machine's Pane opens what it names as it names it.
  const here = handleOf(frame, "e2", project, "agents.thread", undefined)
  here.open(thread({ host: "arc" }), "instead", "r1" as ProjectId)
  expect(open).toHaveBeenLastCalledWith(
    "r1",
    thread({ host: "arc" }),
    "e2",
    "instead"
  )
  here.open(thread())
  expect(open).toHaveBeenLastCalledWith(project, thread(), "e2", undefined)
})
