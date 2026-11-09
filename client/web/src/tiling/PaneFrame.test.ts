import type { ProjectId, ProjectSummary } from "@banda/contract"
import { KeptHosts, keyNamed } from "@banda/core/react"
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

/** This machine's Project `mine`. */
const mine = {
  id: "mine",
  name: "mine",
  folder: "/mine",
  pinned: false,
  archived: false,
  sees_others: false,
  sign: { kind: "letters", text: "M", picked: false },
  trusted: true,
  scratch: false,
  missing: false,
} satisfies ProjectSummary

/** Where the Window's hosts place a Pane of a Project (`KeptHosts.paneOn`),
 * as the Window gives it: this machine has `mine` and its Host scope
 * `m0`, and no host is shown. */
function paneOnOf() {
  const kept = new KeptHosts(
    {
      follow: () => undefined,
      engine: () => Promise.reject(new Error("not here")),
      start: () => undefined,
    },
    { seen: keyNamed, follow: () => () => undefined }
  )
  kept.ours([mine], "m0" as ProjectId)
  return (project: ProjectId, pane: PaneState) => kept.paneOn(project, pane)
}

test("a Pane on another host opens on that host what names none, and what names its own where it names it", () => {
  const { frame, open, update } = frameOf()
  const project = "banda" as ProjectId
  const paneOn = paneOnOf()
  const arc = handleOf(frame, "e1", project, "agents.thread", "arc", paneOn)

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
  const here = handleOf(
    frame,
    "e2",
    project,
    "agents.thread",
    undefined,
    paneOn
  )
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

test("a Pane on another host opens what goes to this machine's Project, or its No Project, on this machine from the first frame (#1004)", () => {
  const { frame, open } = frameOf()
  const arc = handleOf(
    frame,
    "e1",
    "banda" as ProjectId,
    "agents.thread",
    "arc",
    paneOnOf()
  )

  // A new Thread moved to this machine's Project names no host, and
  // takes none of arc's, so it never says arc.
  arc.open(thread(), "instead", "mine" as ProjectId)
  expect(open).toHaveBeenLastCalledWith("mine", thread(), "e1", "instead")
  // Nor does one that names arc: this machine wins the ID.
  arc.open(thread({ host: "arc" }), "instead", "mine" as ProjectId)
  expect(open).toHaveBeenLastCalledWith("mine", thread(), "e1", "instead")
  // Its No Project, which this machine's Host scope is, is this machine's
  // too.
  arc.open(thread(), "instead", "m0" as ProjectId)
  expect(open).toHaveBeenLastCalledWith("m0", thread(), "e1", "instead")
})

test("a Pane this machine took back in a clash lets the other host go as it updates, before its frame does", () => {
  const { frame, update } = frameOf()
  const here = handleOf(
    frame,
    "e2",
    "mine" as ProjectId,
    "agents.thread",
    undefined,
    paneOnOf()
  )

  // Its args still name arc until its frame's effect lets it go.
  here.update({ thread: "t1", host: "arc" })
  expect(update).toHaveBeenLastCalledWith("e2", {
    kind: "agents.thread",
    args: { thread: "t1" },
  })
})
