import { expect, test } from "vitest"
import type { ProjectSummary } from "@banda/contract"
import { type Entry, entriesOf, machinesTo } from "./CardMenu"

/** Another Project to move to, from one of the Person's own. */
const MOVES = { moves: true }

test("the card's menu by place: Open, its acts, its names, Copy and Show folder; Delete… in the Archive alone (ADR 0098, decision 14)", () => {
  const base: Entry[][] = [
    ["open", "beside"],
    ["archive", "later", "unread"],
    ["rename", "fork", "move"],
    ["copy", "folder"],
  ]
  // Done and seen, in Open.
  expect(entriesOf("open", { mark: "done", seen: true }, MOVES)).toEqual(base)
  // Done and unseen, in Your turn: Mark as read.
  expect(entriesOf("turn", { mark: "done", seen: false }, MOVES)[1]).toEqual([
    "archive",
    "later",
    "read",
  ])
  // Nothing finished to see: no Mark as unread.
  expect(entriesOf("turn", { mark: "failed" }, MOVES)[1]).toEqual([
    "archive",
    "later",
  ])
  // No other Project to go to: no Move to Project, and nothing greyed.
  expect(
    entriesOf("open", { mark: "done", seen: true }, { moves: false })[2]
  ).toEqual(["rename", "fork"])
})

test("an asking card keeps Archive, which S's toast refuses, but no Mark as unread, and neither forks nor moves", () => {
  expect(entriesOf("turn", { mark: "asking", seen: true }, MOVES)).toEqual([
    ["open", "beside"],
    ["archive", "later"],
    ["rename"],
    ["copy", "folder"],
  ])
})

test("a working card: Later…, Later — when done and Stop, in Archive's place; it neither forks nor moves", () => {
  expect(entriesOf("working", { mark: "working" }, MOVES)).toEqual([
    ["open", "beside"],
    ["later", "done", "stop"],
    ["rename"],
    ["copy", "folder"],
  ])
})

test("in Later, Wake now, then Later… for another time", () => {
  expect(entriesOf("later", { mark: "done", seen: true }, MOVES)[1]).toEqual([
    "wake",
    "later",
  ])
  // Put off at work, it neither forks nor moves.
  expect(entriesOf("later", { mark: "working" }, MOVES)[2]).toEqual(["rename"])
})

test("in the Archive: Unarchive, and Delete… last, on its own", () => {
  expect(entriesOf("archived", { mark: "done", seen: true }, MOVES)).toEqual([
    ["open", "beside"],
    ["unarchive"],
    ["rename", "fork", "move"],
    ["copy", "folder"],
    ["delete"],
  ])
  for (const stand of ["turn", "open", "working", "later"] as const)
    expect(entriesOf(stand, { mark: "done" }, MOVES).flat()).not.toContain(
      "delete"
    )
})

test("in No Project: Make a Project from it…, last of its names, whatever it does (ADR 0046)", () => {
  const scratch = { moves: true, scratch: true }
  expect(entriesOf("open", { mark: "done", seen: true }, scratch)[2]).toEqual([
    "rename",
    "fork",
    "move",
    "make",
  ])
  expect(entriesOf("turn", { mark: "asking" }, scratch)[2]).toEqual([
    "rename",
    "make",
  ])
})

test("Move to Project lists each other machine under its name, an away one with no Projects", () => {
  const project = (id: string) => ({ id, name: id }) as ProjectSummary
  const arc = { name: "arc", icon: "server" as const }
  const mini = { name: "mini", icon: "desktop" as const }
  expect(
    machinesTo([
      { state: "live", projects: [project("s1")] },
      { host: "arc", named: arc, state: "live", projects: [project("a1")] },
      { host: "mini", named: mini, state: "away", projects: [project("m1")] },
    ])
  ).toEqual([
    { host: "arc", named: arc, away: false, projects: [project("a1")] },
    { host: "mini", named: mini, away: true, projects: [] },
  ])
  // With this machine alone, or outside a Window, there is none.
  expect(machinesTo([{ state: "live", projects: [] }])).toEqual([])
  expect(machinesTo(undefined)).toEqual([])
})
