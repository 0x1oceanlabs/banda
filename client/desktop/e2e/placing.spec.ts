import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import {
  firstThread,
  layoutOf,
  newProject,
  projectId,
  startWindow,
  textOf,
  type Window,
} from "./window"

let window: Window

/** A Thread's kind of Pane. */
const THREAD = "agents.thread"

test.afterEach(async () => {
  await window?.close()
})

type Kept = {
  id: string
  project?: string
  columns: {
    group?: string
    width?: string
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
 * whether its column is in a Group. None while no workspace shows one.
 */
function filesAt(window: Window) {
  for (const [w, workspace] of kept(window).entries())
    for (const [c, column] of workspace.columns.entries()) {
      const pane = column.panes.find((one) => one.kind === "files.tree")
      if (!pane) continue
      const grouped = column.group !== undefined
      const owned = workspace.project !== undefined
      return { pane: pane.id, at: { workspace: w, column: c, owned, grouped } }
    }
  return undefined
}

for (const flow of ["free", "row", "solo"] as const)
  test(`in the Flow ${flow}, Files lands in the same place opened by its key, by a program that names no place and by banda files (ADR 0110)`, async () => {
    window = await startWindow({
      files: { "config/tiling.toml": `flow = "${flow}"\n` },
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
    // Right of the terminal on its workspace, in no Group: in the row and
    // solo, the Project's; in the Flow free, no one's.
    expect(byKey).toEqual({
      workspace: 0,
      column: 1,
      owned: flow !== "free",
      grouped: false,
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

test("a rule of tiling.toml holds from a key, a program and banda: how wide a kind's column opens, and where (ADR 0127, decision 4)", async () => {
  // A terminal opens a third wide, and Files two thirds, over the narrow
  // width its kind asks for.
  const rules =
    '[rule.terminal.terminal]\nwidth = "1/3"\n\n[rule.files.tree]\nwidth = "2/3"\n'
  window = await startWindow({
    files: { "config/tiling.toml": `flow = "free"\n\n${rules}` },
  })
  const { page, dir } = window
  await firstThread(page)
  const work = projectId(window, "Work")
  const folder = join(dir, "root", "Work")
  await page.keyboard.press("Alt+KeyW")
  await expect(page.locator("section[data-tile]")).toHaveCount(0)
  const tiles = page.locator("section[data-tile]")
  const columns = () => kept(window)[0].columns

  // The Person's key: the terminal's column is a third of the screen.
  await page.keyboard.press("Control+Alt+Enter")
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  expect(columns().map((column) => column.width)).toEqual(["1/3"])

  /** Files' column once `open` opened it, as the engine keeps it; then
   * Files closes. */
  const opened = async (open: () => Promise<unknown> | unknown) => {
    await open()
    await expect.poll(() => filesAt(window)?.at).toBeDefined()
    const { pane, at } = filesAt(window)!
    await expect(tiles).toHaveCount(2)
    const column = columns()[at.column]
    // The columns' widths once they are still: two reads that agree.
    const read = () =>
      page.evaluate(() => {
        const strip = document
          .querySelector("section[data-tile]")!
          .closest<HTMLElement>("[data-strip]")!
        const style = getComputedStyle(strip)
        const px = (length: string) => parseFloat(length) || 0
        return {
          columns: [
            ...strip.querySelectorAll<HTMLElement>("[data-column]"),
          ].map((one) => one.offsetWidth),
          room:
            strip.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
          gap: px(style.columnGap),
        }
      })
    let drawn = await read()
    await expect
      .poll(async () => {
        const was = drawn
        drawn = await read()
        return drawn.columns.join() === was.columns.join()
      })
      .toBe(true)
    window.banda("call", "workspaces.close", "--params", `{"pane":"${pane}"}`)
    await expect.poll(() => filesAt(window)).toBeUndefined()
    await expect(tiles).toHaveCount(1)
    return {
      at: at.column,
      width: column.width,
      panes: column.panes.length,
      drawn,
    }
  }
  const params = { project: work, kind: "files.tree", args: { dir: folder } }
  const program = () =>
    window.banda("call", "workspaces.open", "--params", JSON.stringify(params))
  const ways = [
    () => page.keyboard.press("Alt+KeyE"),
    program,
    () => window.banda("files", folder),
  ]
  for (const way of ways) {
    const files = await opened(way)
    expect(files).toMatchObject({ at: 1, width: "2/3", panes: 1 })
    // Drawn so: two thirds of the Strip's room, where its kind's own
    // width would be as narrow as the terminal's third. The look's `min`
    // keeps a third readable, so it is not twice as wide on this screen.
    // The columns are measured, not their tiles: a column opens at its
    // width, and its tile comes in from half its size (the look's `open`),
    // so a tile read on the way is any width up to its column's.
    const { room, gap } = files.drawn
    const [terminal, tree] = files.drawn.columns
    expect(Math.abs(tree - ((2 / 3) * (room + gap) - gap))).toBeLessThan(1)
    expect(tree / terminal).toBeGreaterThan(1.2)
  }

  // A rule written through banda holds from the next Pane, with no
  // restart: Files opens under the Pane in front, in its column.
  window.banda(
    "settings",
    "set",
    "tiling.toml",
    "rule.files.tree.opens",
    "below"
  )
  expect(textOf(join(dir, "config/tiling.toml"))).toContain(
    '[rule.files.tree]\nwidth = "2/3"\nopens = "below"\n'
  )
  // By the key, from the terminal in front.
  expect(await opened(ways[0])).toMatchObject({ at: 0, panes: 2 })
  // A program names no Pane in front, so the rule gives way to the Flow.
  expect(await opened(program)).toMatchObject({ at: 1, width: "2/3" })

  // A rule of a kind no App has, and a value that is none, are refused
  // as they are written, and the file stays as it was.
  const before = textOf(join(dir, "config/tiling.toml"))
  for (const [key, value] of [
    ["rule.files.shelf.width", "1/3"],
    ["rule.files.tree.width", "wide"],
    ["rule.files.tree.opens", "sideways"],
  ])
    expect(() =>
      window.banda("settings", "set", "tiling.toml", key, value)
    ).toThrow()
  expect(textOf(join(dir, "config/tiling.toml"))).toBe(before)
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
    files: { "config/tiling.toml": 'flow = "row"\n' },
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

  // In the Flow free every workspace takes any Pane. Written under the
  // Flow's old file and name, it lands in tiling.toml (ADR 0069 grace).
  window.banda("settings", "set", "agents.toml", "flow", "free")
  expect(textOf(join(dir, "config/tiling.toml"))).toMatch(/^flow = "free"$/m)
  await expect(page.getByRole("button", { name: "Flow: Free" })).toBeVisible()
  window.banda(...call("move_pane", moved))
  const columns = kept(window).find((one) => one.id === theirs.workspace)!
  expect(columns.columns[0].panes[0].id).toBe(ours.pane)
})

for (const flow of ["free", "row"] as const)
  test(`in the Flow ${flow}, a path clicked in a Thread opens in its Group, and Alt+E and Alt+D open right of the Group (ADR 0134)`, async () => {
    window = await startWindow({
      files: { "config/tiling.toml": `flow = "${flow}"\n` },
    })
    const { page, dir } = window
    const { thread, composer } = await firstThread(page)
    mkdirSync(join(dir, "root", "Work", "src"))
    writeFileSync(join(dir, "root", "Work", "src", "app.js"), "export {}\n")
    await composer.fill("See src/app.js in prose.")
    await composer.press("Enter")
    const link = thread.locator("[data-quotable] a[data-file]")
    await expect(link).toHaveText("src/app.js")

    /** Each column of the Thread's workspace by its Panes' kinds, and by
     * whether it is in the Thread's Group. */
    const columns = () => {
      const workspace = kept(window).find((one) =>
        one.columns.some((c) => c.panes.some((p) => p.kind === THREAD))
      )!
      const group = workspace.columns.find((c) =>
        c.panes.some((p) => p.kind === THREAD)
      )!.group
      return workspace.columns.map((c) => ({
        kinds: c.panes.map((p) => p.kind),
        inGroup: group !== undefined && c.group === group,
      }))
    }
    // A click: into the Thread's Group.
    await link.click()
    await expect.poll(columns).toEqual([
      { kinds: [THREAD], inGroup: true },
      { kinds: ["files.file"], inGroup: true },
    ])

    // Alt+E and Alt+D from the Thread: right of the whole Group, each
    // next to it.
    await thread.click({ position: { x: 10, y: 10 } })
    await page.keyboard.press("Alt+KeyE")
    await expect.poll(() => columns().length).toBe(3)
    await thread.click({ position: { x: 10, y: 10 } })
    await page.keyboard.press("Alt+KeyD")
    await expect.poll(columns).toEqual([
      { kinds: [THREAD], inGroup: true },
      { kinds: ["files.file"], inGroup: true },
      { kinds: ["git.diff"], inGroup: false },
      { kinds: ["files.tree"], inGroup: false },
    ])
    await page.screenshot({ path: `test-results/placing-via-${flow}.png` })
  })

// The row joins once the Project's own Group goes (ADR 0134, step 2,
// #1785): until then Alt+E in the row opens into it.
for (const flow of ["free"] as const)
  test(`in the Flow ${flow}, banda files typed in a terminal beside a Thread's Group lands where Alt+E in that terminal does (ADR 0134, decision 4)`, async () => {
    window = await startWindow({
      files: { "config/tiling.toml": `flow = "${flow}"\n` },
    })
    const { page } = window
    await firstThread(page)
    // Two terminals right of the Thread's Group, by the Person's key: the
    // first is where `banda` is typed, the second keeps it from being
    // last, so "right of it" is not "last on the workspace".
    const screens = page.getByRole("region", { name: "Terminal screen" })
    await page.keyboard.press("Control+Alt+Enter")
    await expect(screens).toHaveCount(1)
    await expect(screens.first()).toHaveAttribute("data-state", "running")
    await page.keyboard.press("Control+Alt+Enter")
    await expect(screens).toHaveCount(2)
    await expect(screens.nth(1)).toHaveAttribute("data-state", "running")
    const terminal = screens.first()

    /** Each column of the Thread's workspace by its Panes' kinds, and
     * whether it is in a Group. */
    const columns = () => {
      const workspace = kept(window).find((one) =>
        one.columns.some((c) => c.panes.some((p) => p.kind === THREAD))
      )!
      return workspace.columns.map((c) => ({
        kinds: c.panes.map((p) => p.kind),
        grouped: c.group !== undefined,
      }))
    }
    /** The columns once `open` opened Files from the first terminal;
     * then Files closes. */
    const placed = async (open: () => Promise<unknown>) => {
      await terminal.click()
      await open()
      await expect.poll(() => filesAt(window)).toBeDefined()
      const at = columns()
      const { pane } = filesAt(window)!
      window.banda("call", "workspaces.close", "--params", `{"pane":"${pane}"}`)
      await expect.poll(() => filesAt(window)).toBeUndefined()
      return at
    }

    const byKey = await placed(() => page.keyboard.press("Alt+KeyE"))
    expect(byKey).toEqual([
      { kinds: [THREAD], grouped: true },
      { kinds: ["terminal.terminal"], grouped: false },
      { kinds: ["files.tree"], grouped: false },
      { kinds: ["terminal.terminal"], grouped: false },
    ])
    // The CLI typed in that terminal, which tells it its Pane.
    const banda = join(import.meta.dirname, "../../../target/debug/banda")
    const typed = await placed(async () => {
      await page.keyboard.type(`'${banda}' files .`)
      await page.keyboard.press("Enter")
    })
    expect(typed).toEqual(byKey)
    await page.screenshot({
      path: `test-results/placing-banda-pane-${flow}.png`,
    })
  })
