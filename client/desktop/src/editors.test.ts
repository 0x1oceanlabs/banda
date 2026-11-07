import { expect, test } from "vitest"
import {
  argsFor,
  EDITORS,
  findEditors,
  foldersOf,
  type Machine,
  noAppFor,
} from "./editors"

/** A machine with only these programs on it. */
const machine = (
  platform: NodeJS.Platform,
  programs: readonly string[],
  path = "/usr/bin:/bin"
): Machine => ({
  platform,
  home: "/home/me",
  path,
  runs: (file) => programs.includes(file),
})

test("VS Code and its kin go to a line with --goto, and open a path alone without one", () => {
  expect(argsFor("goto", "/src/a.ts", 12, 3)).toEqual([
    "--goto",
    "/src/a.ts:12:3",
  ])
  expect(argsFor("goto", "/src/a.ts", 12)).toEqual(["--goto", "/src/a.ts:12"])
  expect(argsFor("goto", "/src/a.ts")).toEqual(["/src/a.ts"])
})

test("a JetBrains IDE takes --line and --column before the path, the column only with a line", () => {
  expect(argsFor("line", "/src/a.kt", 12, 3)).toEqual([
    "--line",
    "12",
    "--column",
    "3",
    "/src/a.kt",
  ])
  expect(argsFor("line", "/src/a.kt", 12)).toEqual([
    "--line",
    "12",
    "/src/a.kt",
  ])
  expect(argsFor("line", "/src/a.kt", null, 3)).toEqual(["/src/a.kt"])
})

test("Zed and Sublime Text take the line after the path", () => {
  expect(argsFor("path", "/src/a.rs", 7, 2)).toEqual(["/src/a.rs:7:2"])
  expect(argsFor("path", "/src/a.rs", 7)).toEqual(["/src/a.rs:7"])
  expect(argsFor("path", "/src/my notes.md")).toEqual(["/src/my notes.md"])
})

test("a path with spaces or a shell's signs stays one argument, as written", () => {
  const path = "/tmp/a b/$(rm -rf ~); `x`.ts"
  for (const style of ["goto", "line", "path"] as const)
    expect(argsFor(style, path, 1).at(-1)).toContain(path)
})

test("an editor is found by its command on PATH, in the list's order", () => {
  const found = findEditors(
    machine(
      "linux",
      ["/usr/bin/zeditor", "/opt/tools/code"],
      "/opt/tools:/usr/bin"
    )
  )
  expect(found).toEqual([
    {
      id: "vscode",
      name: "VS Code",
      style: "goto",
      command: "/opt/tools/code",
    },
    { id: "zed", name: "Zed", style: "path", command: "/usr/bin/zeditor" },
  ])
})

test("off PATH, an editor is found where its installer puts it: ~/.local/bin, a Flatpak's exports, the JetBrains Toolbox", () => {
  const found = findEditors(
    machine("linux", [
      "/home/me/.local/bin/zed",
      "/var/lib/flatpak/exports/bin/com.visualstudio.code",
      "/home/me/.local/share/JetBrains/Toolbox/scripts/rustrover",
      "/opt/sublime_text/sublime_text",
    ])
  ).map((editor) => [editor.id, editor.command])
  expect(found).toEqual([
    ["vscode", "/var/lib/flatpak/exports/bin/com.visualstudio.code"],
    ["zed", "/home/me/.local/bin/zed"],
    ["sublime", "/opt/sublime_text/sublime_text"],
    ["rustrover", "/home/me/.local/share/JetBrains/Toolbox/scripts/rustrover"],
  ])
})

test("on macOS an editor is found in its app, in either Applications folder", () => {
  const found = findEditors(
    machine("darwin", [
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      "/home/me/Applications/Zed.app/Contents/MacOS/cli",
      "/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea",
    ])
  ).map((editor) => [editor.id, editor.command])
  expect(found).toEqual([
    [
      "vscode",
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    ],
    ["zed", "/home/me/Applications/Zed.app/Contents/MacOS/cli"],
    ["idea", "/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea"],
  ])
})

test("an app's folders count only on their own system, and a command found first wins", () => {
  const programs = [
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
    "/usr/share/cursor/bin/cursor",
  ]
  expect(findEditors(machine("linux", programs))[0].command).toBe(
    "/usr/share/cursor/bin/cursor"
  )
  expect(
    findEditors(machine("darwin", [...programs, "/usr/local/bin/cursor"]))[0]
      .command
  ).toBe("/usr/local/bin/cursor")
})

test("none found, none listed; a relative folder on PATH is never looked in", () => {
  expect(findEditors(machine("linux", ["bin/code"], "bin:."))).toEqual([])
  expect(
    foldersOf(machine("linux", [], "bin:/usr/bin:/usr/bin"))
  ).not.toContain("bin")
})

test("every editor has an id of its own", () => {
  const ids = EDITORS.map((editor) => editor.id)
  expect(new Set(ids).size).toBe(ids.length)
})

/** A Windows machine with only these programs on it, and these folders
 * in each folder `listed` names. */
const windows = (
  programs: readonly string[],
  path: string,
  listed: Record<string, readonly string[]> = {}
): Machine => ({
  platform: "win32",
  home: "C:\\Users\\me",
  path,
  runs: (file) => programs.includes(file),
  programs: ["C:\\Users\\me\\AppData\\Local\\Programs", "C:\\Program Files"],
  list: (folder) => listed[folder] ?? [],
})

test("on Windows an editor is found by its own program, beside its command on PATH, as VS Code's bin\\code.cmd", () => {
  const vscode = "C:\\Tools\\VS Code"
  const found = findEditors(
    windows(
      [`${vscode}\\bin\\code.cmd`, `${vscode}\\Code.exe`],
      `C:\\Windows\\system32;${vscode}\\bin`
    )
  )
  expect(found).toEqual([
    {
      id: "vscode",
      name: "VS Code",
      style: "goto",
      command: `${vscode}\\Code.exe`,
    },
  ])
})

test("on Windows an editor off PATH is found where its installer puts it, a JetBrains IDE's newest version first", () => {
  const local = "C:\\Users\\me\\AppData\\Local\\Programs"
  const jetbrains = "C:\\Program Files\\JetBrains"
  const found = findEditors(
    windows(
      [
        `${local}\\cursor\\Cursor.exe`,
        `${local}\\Zed\\bin\\zed.exe`,
        "C:\\Program Files\\Sublime Text\\subl.exe",
        `${jetbrains}\\IntelliJ IDEA 2024.3\\bin\\idea64.exe`,
        `${jetbrains}\\IntelliJ IDEA 2025.2\\bin\\idea64.exe`,
        `${local}\\PyCharm Professional\\bin\\pycharm64.exe`,
        `${jetbrains}\\Jetbrains Rider 2025.1\\bin\\rider64.exe`,
      ],
      "C:\\Windows\\system32",
      {
        [local]: ["cursor", "Zed", "PyCharm Professional"],
        [jetbrains]: [
          "IntelliJ IDEA 2024.3",
          "IntelliJ IDEA 2025.2",
          // Windows' names are the same in any case.
          "Jetbrains Rider 2025.1",
        ],
      }
    )
  ).map((editor) => [editor.id, editor.command])
  expect(found).toEqual([
    ["cursor", `${local}\\cursor\\Cursor.exe`],
    ["zed", `${local}\\Zed\\bin\\zed.exe`],
    ["sublime", "C:\\Program Files\\Sublime Text\\subl.exe"],
    ["idea", `${jetbrains}\\IntelliJ IDEA 2025.2\\bin\\idea64.exe`],
    ["pycharm", `${local}\\PyCharm Professional\\bin\\pycharm64.exe`],
    ["rider", `${jetbrains}\\Jetbrains Rider 2025.1\\bin\\rider64.exe`],
  ])
})

test("on Windows no editor is looked for on a share, among the store's stubs, or as a .cmd", () => {
  const share = "\\\\server\\tools"
  const stubs = "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps"
  const machine = windows(
    [`${share}\\Code.exe`, `${stubs}\\Code.exe`, "C:\\bin\\code.cmd"],
    `${share};${stubs};C:\\bin;bin`
  )
  expect(findEditors(machine)).toEqual([])
  expect(foldersOf(machine)).toEqual(["C:\\bin"])
})

test("a .toml opens in an editor on Windows, which has no app for one; elsewhere in the system's", () => {
  expect(
    noAppFor(
      "C:\\Users\\me\\AppData\\Local\\banda\\config\\sidebar.toml",
      "win32"
    )
  ).toBe(true)
  expect(noAppFor("C:\\work\\Cargo.TOML", "win32")).toBe(true)
  expect(noAppFor("C:\\work\\notes.md", "win32")).toBe(false)
  expect(noAppFor("/home/me/.config/banda/sidebar.toml", "linux")).toBe(false)
  expect(noAppFor("/Users/me/Library/banda/sidebar.toml", "darwin")).toBe(false)
})
