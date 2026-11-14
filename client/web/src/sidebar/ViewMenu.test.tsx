// @vitest-environment happy-dom
import type { Look } from "@banda/contract/look"
import { DEFAULT_SIDEBAR, type Sidebar } from "@banda/contract/sidebar"
import { takeLook } from "@banda/ui/lib/look"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { device } from "../boot"
import { ViewRows } from "./ViewMenu"

vi.mock("../boot", () => ({
  device: {
    settings: { set: vi.fn(() => Promise.resolve([])) },
    sidebar: { edit: vi.fn() },
  },
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
let page: HTMLElement

beforeEach(() => {
  page = document.body.appendChild(document.createElement("div"))
})

afterEach(() => {
  act(() => root?.unmount())
  page.remove()
  vi.mocked(device.settings.set).mockClear()
  vi.mocked(device.sidebar.edit).mockClear()
})

/** The menu's rows for `sidebar`, as the look has it, in force too. */
function draw(sidebar: Sidebar = DEFAULT_SIDEBAR) {
  takeLook({ sidebar } as Look)
  root = createRoot(page)
  act(() => root?.render(<ViewRows sidebar={sidebar} />))
}

/** The option `name` of the choice `label`. */
const option = (label: string, name: string) =>
  [
    ...page.querySelectorAll(
      `[role=radiogroup][aria-label="${label}"] [role=radio]`
    ),
  ].find((one) => one.textContent === name) as HTMLElement

const picked = (label: string) =>
  [
    ...page.querySelectorAll(
      `[role=radiogroup][aria-label="${label}"] [aria-checked=true]`
    ),
  ].map((one) => one.textContent)

const switchOf = (label: string) =>
  page.querySelector<HTMLElement>(`[role=switch][aria-label="${label}"]`)!

const writes = () => vi.mocked(device.settings.set).mock.calls

test("the view menu picks how the list is grouped and Your turn's order, each as sidebar.toml has it (ADR 0098, decisions 3 and 7)", () => {
  draw({ ...DEFAULT_SIDEBAR, group: "project" })
  expect(
    [...page.querySelectorAll("[role=radiogroup]")].map((one) => [
      one.getAttribute("aria-label"),
      [...one.querySelectorAll("[role=radio]")].map((it) => it.textContent),
    ])
  ).toEqual([
    ["Group by", ["None", "Project"]],
    ["Your turn first", ["Oldest", "Newest"]],
  ])
  expect(picked("Group by")).toEqual(["Project"])
  expect(picked("Your turn first")).toEqual(["Oldest"])

  act(() => option("Group by", "None").click())
  act(() => option("Your turn first", "Newest").click())
  // The one picked already writes nothing.
  act(() => option("Your turn first", "Oldest").click())
  expect(writes()).toEqual([
    ["sidebar.toml", "group", '"none"'],
    ["sidebar.toml", "inbox.order", '"newest"'],
  ])
})

test("its switches show the Inbox's parts as they are, and a click writes the other way", () => {
  draw({
    ...DEFAULT_SIDEBAR,
    inbox: { order: "oldest", open: true, working: false },
  })
  const labels = ["Open in the inbox", "Working shelf in the inbox"]
  expect(
    labels.map((label) => switchOf(label).getAttribute("aria-checked"))
  ).toEqual(["true", "false"])
  for (const label of labels) act(() => switchOf(label).click())
  expect(writes()).toEqual([
    ["sidebar.toml", "inbox.open", "false"],
    ["sidebar.toml", "inbox.working", "true"],
  ])
})

test("Edit sidebar.toml opens the file", () => {
  draw()
  const edit = [...page.querySelectorAll("button")].find(
    (one) => one.textContent === "Edit sidebar.toml"
  )
  act(() => edit?.click())
  expect(device.sidebar.edit).toHaveBeenCalledOnce()
})
