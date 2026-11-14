import type { ProjectSummary } from "@banda/contract"
import type { Named } from "@banda/contract/machines"
import type { MachineRows } from "@banda/contract/sidebar"
import { thisNamed } from "@banda/core"
import type { Stand } from "@banda/ui/status"
import { expect, test } from "vitest"
import type { Row } from "./rows"
import { cardOf } from "./card"
import { machineOnRow, type OnRow } from "./machine-on-row"

const arc: Named = { name: "arc", icon: "server" }
const mac: Named = { name: "mac", icon: "laptop" }
const free = { rows: "named", labelled: false } as const

test("named gives the machine as it is, its name and its icon", () => {
  expect(machineOnRow(arc, free)).toEqual(arc)
})

test("icon gives the machine with its icon alone", () => {
  expect(machineOnRow(arc, { ...free, rows: "icon" })).toEqual({
    ...arc,
    alone: true,
  })
})

test("off gives no machine", () => {
  expect(machineOnRow(arc, { ...free, rows: "off" })).toBeUndefined()
})

test("a row under a machine's label carries no machine, whatever the choice", () => {
  for (const rows of ["named", "icon", "off"] as const)
    expect(machineOnRow(arc, { rows, labelled: true })).toBeUndefined()
})

test("named as the others are, this machine's rows take the same choice", () => {
  const named = thisNamed(mac, true, true)
  expect(machineOnRow(named, free)).toEqual(mac)
  expect(machineOnRow(named, { ...free, rows: "icon" })).toEqual({
    ...mac,
    alone: true,
  })
  expect(machineOnRow(named, { ...free, rows: "off" })).toBeUndefined()
  expect(machineOnRow(named, { ...free, labelled: true })).toBeUndefined()
})

test("with one machine, this-too names no row", () => {
  expect(machineOnRow(thisNamed(mac, true, false), free)).toBeUndefined()
})

const row: Row = {
  project: { id: "p", name: "banda" } as ProjectSummary,
  listed: {
    id: "t",
    title: "t",
    mark: "asking",
    changed: 5,
    harness: "claude",
    pane: { kind: "agents.thread", args: {} },
  },
  stand: "turn",
  host: "arc",
}
const on = (machine: OnRow | undefined) => (machine ? { machine } : {})
/** The machine slots of `row`'s card in `place`, by line, as `rows` has
 * the machine. */
const machinesOn = (rows: MachineRows, place: Stand = "turn") =>
  cardOf({
    row,
    place,
    at: 5,
    now: 5,
    view: { group: "none" },
    ...on(machineOnRow(arc, { rows, labelled: false })),
  }).lines.map((line) => line.right.filter((slot) => slot.kind === "machine"))
const slot = (named: boolean) => ({
  kind: "machine",
  host: "arc",
  machine: arc,
  named,
})

test("a card names the machine on line 3, wherever it stands, by its icon alone with icon, and with off nowhere (ADR 0095, decision 5)", () => {
  for (const place of ["turn", "open"] as const) {
    expect(machinesOn("named", place)).toEqual([[], [], [slot(true)]])
    expect(machinesOn("icon", place)).toEqual([[], [], [slot(false)]])
    expect(machinesOn("off", place)).toEqual([[], [], []])
  }
})
