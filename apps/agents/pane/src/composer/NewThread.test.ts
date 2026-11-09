import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Machine } from "@banda/ui/hooks/use-machines"
import { expect, test } from "vitest"
import type { ThreadArgs } from "../thread/session"
import { groupsOf, movedArgs } from "./NewThread"

const project = (id: string) =>
  ({
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
  }) satisfies ProjectSummary

const arc = { name: "arc", icon: "server" } as const

test("the picker groups the Window's machines, this one first; a machine with nothing to start in has none", () => {
  const machines: Machine[] = [
    { machine: "m0" as ProjectId, state: "live", projects: [project("work")] },
    {
      host: "arc",
      named: arc,
      machine: "m1" as ProjectId,
      state: "away",
      away: 5,
      projects: [project("banda")],
    },
    { host: "devbox", named: arc, state: "live", projects: [] },
  ]
  const groups = groupsOf(machines, {
    host: undefined,
    away: false,
    machine: "m0" as ProjectId,
    projects: [],
  })
  expect(
    groups.map(({ host, named, away, machine, projects }) => [
      host,
      named?.name,
      away,
      machine,
      projects.map((one) => one.id),
    ])
  ).toEqual([
    [undefined, undefined, false, "m0", ["work"]],
    ["arc", "arc", true, "m1", ["banda"]],
  ])
})

test("on another machine, the picker has that machine's No Project as soon as its own engine names it", () => {
  const machines: Machine[] = [
    { machine: "m0" as ProjectId, state: "live", projects: [] },
    { host: "arc", named: arc, state: "live", projects: [] },
  ]
  const own = {
    host: "arc",
    away: false,
    machine: "m1" as ProjectId,
    projects: [],
  }
  expect(groupsOf(machines, own).map((group) => group.machine)).toEqual([
    "m0",
    "m1",
  ])
})

test("outside a Window, as in a window of its own, the picker has its own engine's Projects alone", () => {
  const own = {
    host: "arc",
    away: false,
    machine: "m1" as ProjectId,
    projects: [project("banda")],
  }
  expect(groupsOf(undefined, own)).toEqual([own])
})

test("a new Thread moved to another machine drops its Harness and its folder's making; on its own machine it keeps them", () => {
  const draft: ThreadArgs = {
    thread: null,
    harness: "",
    title: "",
    scratch: "s1" as ProjectId,
    scratchCommand: "c1",
  }
  expect(movedArgs(draft, "claude", undefined)).toEqual({
    thread: null,
    harness: "claude",
    title: "",
    scratch: undefined,
    scratchCommand: "c1",
  })
  // A Harness of this machine may not be on arc: arc starts it on its own.
  expect(movedArgs(draft, "claude", "arc")).toEqual({
    thread: null,
    harness: "",
    title: "",
    scratch: undefined,
    scratchCommand: undefined,
  })
  // From arc back to this machine, the same.
  const there = { ...draft, host: "arc" }
  expect(movedArgs(there, "codex", undefined)).toMatchObject({
    harness: "",
    scratchCommand: undefined,
  })
  expect(movedArgs(there, "codex", "arc")).toMatchObject({
    harness: "codex",
    scratchCommand: "c1",
  })
})
