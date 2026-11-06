import { expect, test } from "vitest"
import { editorsOf } from "./outside"

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
