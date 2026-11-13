import { join } from "node:path"
import { expect, test } from "@playwright/test"
import {
  firstThread,
  layoutOf,
  newProject,
  projectId,
  startWindow,
  type Window,
} from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

type Kept = {
  id: string
  project?: string
  own?: string
  columns: {
    group?: string
    panes: { id: string; kind: string }[]
  }[]
}

/** The workspaces as the engine keeps them, read from outside the Window. */
function kept(window: Window): Kept[] {
  const listed = JSON.parse(window.banda("call", "workspaces.list")) as {
    ok: { workspaces: Kept[] }
  }
  return listed.ok.workspaces
}

/**
 * Where the one Files Pane stands, as the engine keeps it: its workspace
 * and its column, from 0, whether that workspace is a Project's, and
 * whether its column is in the Project's own Group. None while no
 * workspace shows one.
 */
function filesAt(window: Window) {
  for (const [w, workspace] of kept(window).entries())
    for (const [c, column] of workspace.columns.entries()) {
      const pane = column.panes.find((one) => one.kind === "files.tree")
      if (!pane) continue
      const own = column.group !== undefined && column.group === workspace.own
      const owned = workspace.project !== undefined
      return { pane: pane.id, at: { workspace: w, column: c, owned, own } }
    }
  return undefined
}

for (const flow of ["free", "row", "solo"] as const)
  test(`in the Flow ${flow}, Files lands in the same place opened by its key, by a program that names no place and by banda files (ADR 0110)`, async () => {
    window = await startWindow({
      files: { "config/agents.toml": `flow = "${flow}"\n` },
    })
    const { page, dir } = window
    await firstThread(page)
    const work = projectId(window, "Work")
    const folder = join(dir, "root", "Work")
    // A terminal alone on the workspace, the Pane in front.
    await page.keyboard.press("Alt+KeyW")
    await expect(page.locator("section[data-tile]")).toHaveCount(0)
    await page.keyboard.press("Control+Alt+Enter")
    const screen = page.getByRole("region", { name: "Terminal screen" })
    await expect(screen).toHaveAttribute("data-state", "running")

    /** Where Files stands once `open` opened it, drawn there by the
     * window too; then it closes, and the terminal is in front again. */
    const placed = async (open: () => Promise<unknown> | unknown) => {
      await open()
      await expect.poll(() => filesAt(window)?.at).toBeDefined()
      const { pane, at } = filesAt(window)!
      await expect
        .poll(async () => (await layoutOf(page))[at.column])
        .toEqual([pane])
      window.banda("call", "workspaces.close", "--params", `{"pane":"${pane}"}`)
      await expect.poll(() => filesAt(window)).toBeUndefined()
      await expect(page.locator("section[data-tile]")).toHaveCount(1)
      return at
    }

    // The Person's key, from the terminal.
    const byKey = await placed(() => page.keyboard.press("Alt+KeyE"))
    // Right of the terminal on its workspace: in the row and solo, the
    // Project's, in its own Group; in the Flow free, no one's.
    const strict = flow !== "free"
    expect(byKey).toEqual({
      workspace: 0,
      column: 1,
      owned: strict,
      own: strict,
    })
    // A program that names no place, as an Agent's tool and any App do.
    const params = { project: work, kind: "files.tree", args: { dir: folder } }
    const byProgram = await placed(() =>
      window.banda(
        "call",
        "workspaces.open",
        "--params",
        JSON.stringify(params)
      )
    )
    expect(byProgram).toEqual(byKey)
    // The CLI.
    const byCli = await placed(() => window.banda("files", folder))
    expect(byCli).toEqual(byKey)
  })

/** What `banda` said as it refused: its JSON on stdout, and exit 1. */
function refusedBy(window: Window, ...args: string[]) {
  try {
    window.banda(...args)
  } catch (error) {
    const { status, stdout } = error as { status: number; stdout: string }
    expect(status).toBe(1)
    return (JSON.parse(stdout) as { error: { code: string; message: string } })
      .error
  }
  throw new Error(`banda ${args.join(" ")} was not refused`)
}

test("in the row, banda moves no Pane onto another Project's workspace: the engine refuses it as it does the window's key, and in the Flow free it goes (ADR 0110, decision 8)", async () => {
  window = await startWindow({
    files: { "config/agents.toml": 'flow = "row"\n' },
  })
  const { page, dir } = window
  await firstThread(page)
  await newProject(page, "Play")
  await expect(
    page.getByRole("button", { name: "Project: Play" })
  ).toBeVisible()
  const [work, play] = [projectId(window, "Work"), projectId(window, "Play")]
  const call = (method: string, params: object) =>
    [
      "call",
      `workspaces.${method}`,
      "--params",
      JSON.stringify(params),
    ] as const
  // Files of each Project, where the row puts it: on its own workspace.
  for (const [project, name] of [
    [work, "Work"],
    [play, "Play"],
  ]) {
    const args = { dir: join(dir, "root", name) }
    window.banda(...call("open", { project, kind: "files.tree", args }))
  }
  const owned = (project: string) =>
    kept(window).findIndex((workspace) => workspace.project === project)
  await expect.poll(() => owned(play)).toBeGreaterThan(-1)
  const files = (project: string) => {
    const workspace = kept(window)[owned(project)]
    const column = workspace.columns.find((one) =>
      one.panes.some((pane) => pane.kind === "files.tree")
    )!
    return { workspace: workspace.id, pane: column.panes[0].id }
  }
  const [ours, theirs] = [files(work), files(play)]
  const before = kept(window)

  // By every command that moves, and a Pane brought there.
  const there = { to: "column", workspace: theirs.workspace, index: 0 }
  const words = `Workspace ${owned(play) + 1} is another Project's. A Pane goes to its Project's workspace, a free one or a new one.`
  const refused = { code: "conflict", message: words }
  const moved = { pane: ours.pane, place: there }
  expect(refusedBy(window, ...call("move_pane", moved))).toEqual(refused)
  const beside = { to: "beside", pane: theirs.pane, side: "right" }
  expect(
    refusedBy(window, ...call("move_pane", { pane: ours.pane, place: beside }))
  ).toEqual(refused)
  const brought = {
    project: work,
    kind: "files.tree",
    args: { dir: join(dir, "root") },
    again: true,
    brought: true,
    place: there,
  }
  expect(refusedBy(window, ...call("open", brought))).toEqual(refused)
  expect(kept(window)).toEqual(before)

  // The window's key is refused by the same rule, and says it with the
  // Project's name, which the window knows.
  await page.keyboard.press(`Alt+Digit${owned(work) + 1}`)
  const tile = page.getByRole("region", { name: "Work", exact: true })
  await tile.getByRole("heading", { name: "Work" }).click()
  await page.keyboard.press(`Alt+Shift+Digit${owned(play) + 1}`)
  await expect(
    page
      .getByRole("region", { name: "Notifications" })
      .getByRole("listitem")
      .filter({ hasText: `Workspace ${owned(play) + 1} is Play's` })
  ).toContainText("Work's Panes go to its workspace, a free one or a new one.")
  expect(kept(window)).toEqual(before)

  // In the Flow free every workspace takes any Pane.
  window.banda("settings", "set", "agents.toml", "flow", "free")
  await expect(page.getByRole("button", { name: "Flow: Free" })).toBeVisible()
  window.banda(...call("move_pane", moved))
  const columns = kept(window).find((one) => one.id === theirs.workspace)!
  expect(columns.columns[0].panes[0].id).toBe(ours.pane)
})
