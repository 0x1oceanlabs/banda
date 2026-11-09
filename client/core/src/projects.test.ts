import type { ProjectSummary } from "@banda/contract"
import { expect, test } from "vitest"
import { shownProjects } from "./projects"

const project: ProjectSummary = {
  id: "one",
  name: "Work",
  folder: "/work",
  pinned: false,
  archived: false,
  sees_others: false,
  sign: { kind: "letters", text: "W", picked: false },
  trusted: true,
  scratch: false,
  missing: false,
}

test("pickers omit scratch and archived Projects while keeping pinned Projects first", () => {
  const pinned = { ...project, id: "pin", pinned: true }
  expect(
    shownProjects([
      project,
      { ...project, id: "scratch", scratch: true },
      pinned,
      { ...project, id: "archive", archived: true },
    ])
  ).toEqual([pinned, project])
})
