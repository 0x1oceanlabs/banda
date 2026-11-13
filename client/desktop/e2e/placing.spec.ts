import { join } from "node:path"
import { expect, test } from "@playwright/test"
import {
  firstThread,
  layoutOf,
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
