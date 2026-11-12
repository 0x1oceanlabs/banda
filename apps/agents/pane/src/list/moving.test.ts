import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Machine } from "@banda/core/react"
import { expect, test } from "vitest"
import { busy, placesOf, sized } from "./moving"

const project = (id: string, more: Partial<ProjectSummary> = {}) =>
  ({ id, name: id, folder: `/code/${id}`, ...more }) as ProjectSummary

const machines: Machine[] = [
  { state: "live", projects: [project("s1"), project("s2")] },
  {
    host: "arc",
    named: { name: "arc", icon: "server" },
    state: "live",
    projects: [project("a1"), project("own", { scratch: true })],
  },
  {
    host: "mini",
    named: { name: "mini", icon: "desktop" },
    state: "away",
    projects: [project("m1")],
  },
]

test("the Projects a Thread may move to: its own machine's first, not the one it is in, none of No Project, and none of a machine that is away", () => {
  const here = placesOf(machines, "s1" as ProjectId, undefined)
  expect(
    here.map(({ machine, own, places }) => [
      machine.host,
      own,
      places.map((place) => place.project),
    ])
  ).toEqual([
    [undefined, true, ["s2"]],
    ["arc", false, ["a1"]],
    ["mini", false, []],
  ])
  expect(here[1].places[0]).toEqual({
    project: "a1",
    name: "a1",
    folder: "/code/a1",
    host: "arc",
  })
  // arc's Thread lists arc first, then this machine, whose Projects name
  // no host.
  const there = placesOf(machines, "a1" as ProjectId, "arc")
  expect(there.map(({ machine }) => machine.host)).toEqual([
    "arc",
    undefined,
    "mini",
  ])
  expect(there[0].places).toEqual([])
  expect(there[1].places.map((place) => place.host)).toEqual([
    undefined,
    undefined,
  ])
})

test("a Thread that works or asks moves once it is at rest", () => {
  expect((["working", "asking"] as const).map(busy)).toEqual([true, true])
  expect(
    (["idle", "done", "failed", "later", "woke"] as const).some(busy)
  ).toBe(false)
})

test("a size reads short", () => {
  expect(
    [512, 8 * 1024, 3.14 * 1024 * 1024, 31 * 1024 * 1024].map(sized)
  ).toEqual(["512 B", "8 KB", "3.1 MB", "31 MB"])
})
