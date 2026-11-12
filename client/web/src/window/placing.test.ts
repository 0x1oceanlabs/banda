import type { ProjectId, ProjectSummary } from "@banda/contract"
import { expect, test } from "vitest"
import { goneOf } from "./placing"

const project = (id: string): ProjectSummary => ({
  id,
  name: id,
  folder: `/code/${id}`,
  pinned: false,
  archived: false,
  sees_others: false,
  sign: { kind: "letters", text: id.slice(0, 1), picked: false },
  trusted: true,
  scratch: false,
  missing: false,
})

test("a Project's emptied workspace goes when it has no Threads, is of no Project, or is a Project the window does not know (ADR 0102, decision 2)", () => {
  const known = [project("work"), project("play"), project("machine")]
  const gone = goneOf(["play" as ProjectId], ["machine" as ProjectId], known)
  expect(gone("work" as ProjectId)).toBe(false)
  expect(gone("play" as ProjectId)).toBe(true)
  expect(gone("machine" as ProjectId)).toBe(true)
  // Archived or removed, it is in no list the window draws: the bar
  // could not name its workspace, and it no longer stays for good.
  expect(gone("archived" as ProjectId)).toBe(true)
})
