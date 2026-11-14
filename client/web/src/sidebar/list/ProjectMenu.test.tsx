import type { ProjectSummary } from "@banda/contract"
import type { MarkState } from "@banda/ui/lib/mark-state"
import { MINUTE } from "@banda/ui/lib/words"
import type { Listed } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { archivableIn, entriesOf } from "./ProjectMenu"
import { rowsOf } from "../model/rows"

const project = (id: string): ProjectSummary => ({
  id,
  name: id,
  folder: `/${id}`,
  pinned: false,
  archived: false,
  sees_others: false,
  sign: { kind: "letters", text: id[0]!, picked: false },
  trusted: true,
  scratch: false,
  missing: false,
})
const banda = project("banda")
const work = project("work")

const NOW = new Date(2026, 10, 12, 15, 0).getTime()
const listed = (
  id: string,
  mark: MarkState,
  more: Partial<Listed> = {}
): Listed => ({
  id,
  title: id,
  mark,
  changed: NOW - 10 * MINUTE,
  pane: { kind: "agents.thread", args: { thread: id } },
  ...more,
})

test("a Project's menu: Open folder, Project settings…; then Archive its Threads and Remove from Banda…; no New Thread here (ADR 0098, decision 16, as Roma amended it on 2026-11-12)", () => {
  expect(entriesOf(banda)).toEqual([
    ["folder", "settings"],
    ["archive", "remove"],
  ])
})

test("on a card that asks for trust, Trust… and Not now come first; a missing folder is located first", () => {
  expect(entriesOf(banda, "trust")).toEqual([
    ["trust", "not-now"],
    ["folder", "settings"],
    ["archive", "remove"],
  ])
  const gone = { ...banda, missing: true }
  expect(entriesOf(gone, "missing")).toEqual([
    ["locate", "folder", "settings"],
    ["archive", "remove"],
  ])
})

test("Archive its Threads takes this machine's Threads of the Project that its cards may archive, none that asks or works", () => {
  const rows = [
    ...rowsOf(
      {
        banda: [
          listed("done", "done", { seen: true }),
          listed("failed", "failed"),
          listed("asks", "asking"),
          listed("build", "working", { began: NOW - MINUTE }),
          listed("old", "rest", { archived: true }),
        ],
        work: [listed("font", "done", { seen: true })],
      },
      [banda, work],
      NOW
    ),
    // Another machine's Project of the same id is its own.
    ...rowsOf({ banda: [listed("ship", "done")] }, [banda], NOW, "mac"),
  ]
  expect(archivableIn(rows, banda).map((row) => row.listed.id)).toEqual([
    "done",
    "failed",
  ])
  expect(archivableIn(rows, work).map((row) => row.listed.id)).toEqual(["font"])
})
