import { expect, test } from "vitest"
import type { ProjectId } from "@banda/contract"
import { deviceFile, projectFile } from "@banda/core"
import { editorsOf, openInEditor, openWithSystem, reveal } from "./outside"

const zed = { id: "zed", name: "Zed" }
const code = { id: "vscode", name: "VS Code" }
const idea = { id: "idea", name: "IntelliJ IDEA" }

test("a file opens in the editor files.toml names, the rest offered after it", () => {
  expect(editorsOf([code, zed, idea], "zed")).toEqual({
    editor: zed,
    others: [code, idea],
  })
})

test("with none named, or one not found here, a file opens in the first found", () => {
  expect(editorsOf([code, zed], "")).toEqual({ editor: code, others: [zed] })
  expect(editorsOf([code, zed], "sublime")).toEqual({
    editor: code,
    others: [zed],
  })
})

test("with no editor found, a file opens in none", () => {
  expect(editorsOf([], "zed")).toEqual({ editor: null, others: [] })
})

test("what opens a file on this computer takes only a file this computer holds", async () => {
  const whole = projectFile("p1" as ProjectId, "/code/Same/who.txt")
  // Nothing here runs: tsc is the check, on what it may not be given. A
  // path alone, or a file of a Project's, says nothing of being here.
  const never = (run: () => unknown) => run
  never(() => openInEditor(deviceFile("/code/Same/who.txt")))
  // @ts-expect-error a path alone is no file of this computer's
  never(() => openInEditor("/code/Same/who.txt"))
  // @ts-expect-error a Project's file may be on another machine
  never(() => reveal(whole))
  // @ts-expect-error nor does a path open with the system
  never(() => openWithSystem(whole.path))
  // Outside Banda's desktop window, none of them does anything.
  await expect(openInEditor(deviceFile("/a"))).resolves.toBeUndefined()
})
