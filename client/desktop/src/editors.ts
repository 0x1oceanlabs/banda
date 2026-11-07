/**
 * The code editors on this machine, and how a file opens in one at its
 * line (ADR 0073, decisions 10 and 14), as T3 Code lists and launches them
 * (docs/research/2026-11-04-files.md, §1): Cursor, VS Code and its
 * Insiders, VSCodium, Windsurf, Zed, Sublime Text and the JetBrains IDEs.
 *
 * An editor is found by its command, on PATH or in the folders its
 * installer uses, then by its app's own copy of the command: in an
 * Applications folder on macOS, in /opt or /usr/share on Linux. What is
 * found is kept for the run. An editor starts on its own, apart from
 * Banda, with the path as one argument and no shell between.
 */
import { spawn } from "node:child_process"
import { accessSync, constants, statSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, isAbsolute, join } from "node:path"
import { Refused } from "@banda/desktop-kit"
import { Context, Effect, Layer } from "effect"

/** How an editor takes a line: `--goto path:line:col` (VS Code and its
 * kin), `--line n --column n path` (JetBrains), or `path:line:col` (Zed,
 * Sublime Text). */
export type Style = "goto" | "line" | "path"

/** An editor Banda knows how to find and start. */
type Known = {
  id: string
  name: string
  style: Style
  /** Its command's names, looked for in each folder: a Flatpak's app ID
   * too, as its exports name it. */
  commands: readonly string[]
  /** Its command inside its app, from an Applications folder (macOS). */
  mac?: readonly string[]
  /** Where a package puts its command off PATH (Linux): whole, or from
   * home with `~/`. */
  linux?: readonly string[]
}

/** Where a VS Code-like app keeps its command on macOS. */
const vscodeApp = (app: string, command: string) =>
  `${app}.app/Contents/Resources/app/bin/${command}`

/** A JetBrains IDE: its command is its launcher, in its app on macOS and
 * among the Toolbox's scripts anywhere. */
const jetbrains = (
  id: string,
  name: string,
  command: string,
  apps: readonly string[],
  more: readonly string[] = []
): Known => ({
  id,
  name,
  style: "line",
  commands: [command, ...more],
  mac: apps.map((app) => `${app}.app/Contents/MacOS/${command}`),
})

/** The editors, in the order a menu lists them; the first found is the
 * one a file opens in when `files.toml` names none. */
export const EDITORS: readonly Known[] = [
  {
    id: "cursor",
    name: "Cursor",
    style: "goto",
    commands: ["cursor"],
    mac: [vscodeApp("Cursor", "cursor")],
    linux: [
      "/usr/share/cursor/bin/cursor",
      "/opt/cursor/bin/cursor",
      "/opt/Cursor/resources/app/bin/cursor",
    ],
  },
  {
    id: "vscode",
    name: "VS Code",
    style: "goto",
    commands: ["code", "com.visualstudio.code"],
    mac: [vscodeApp("Visual Studio Code", "code")],
    linux: ["/usr/share/code/bin/code", "/opt/visual-studio-code/bin/code"],
  },
  {
    id: "vscode-insiders",
    name: "VS Code Insiders",
    style: "goto",
    commands: ["code-insiders"],
    mac: [vscodeApp("Visual Studio Code - Insiders", "code-insiders")],
    linux: [
      "/usr/share/code-insiders/bin/code-insiders",
      "/opt/visual-studio-code-insiders/bin/code-insiders",
    ],
  },
  {
    id: "vscodium",
    name: "VSCodium",
    style: "goto",
    commands: ["codium", "com.vscodium.codium"],
    mac: [vscodeApp("VSCodium", "codium")],
    linux: ["/usr/share/codium/bin/codium", "/opt/vscodium-bin/bin/codium"],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    style: "goto",
    commands: ["windsurf"],
    mac: [vscodeApp("Windsurf", "windsurf")],
    linux: ["/usr/share/windsurf/bin/windsurf", "/opt/Windsurf/bin/windsurf"],
  },
  {
    id: "zed",
    name: "Zed",
    style: "path",
    // Arch and Fedora name it zeditor and zedit; its own installer, zed.
    commands: ["zed", "zeditor", "zedit", "dev.zed.Zed"],
    mac: ["Zed.app/Contents/MacOS/cli"],
    linux: ["~/.local/zed.app/bin/zed"],
  },
  {
    id: "sublime",
    name: "Sublime Text",
    style: "path",
    commands: ["subl", "sublime_text", "com.sublimetext.three"],
    mac: ["Sublime Text.app/Contents/SharedSupport/bin/subl"],
    linux: ["/opt/sublime_text/sublime_text"],
  },
  jetbrains(
    "idea",
    "IntelliJ IDEA",
    "idea",
    ["IntelliJ IDEA", "IntelliJ IDEA CE"],
    ["intellij-idea-ultimate", "intellij-idea-community"]
  ),
  jetbrains("webstorm", "WebStorm", "webstorm", ["WebStorm"]),
  jetbrains(
    "pycharm",
    "PyCharm",
    "pycharm",
    ["PyCharm", "PyCharm CE"],
    ["pycharm-professional", "pycharm-community"]
  ),
  jetbrains("goland", "GoLand", "goland", ["GoLand"]),
  jetbrains("rustrover", "RustRover", "rustrover", ["RustRover"]),
  jetbrains("clion", "CLion", "clion", ["CLion"]),
  jetbrains("phpstorm", "PhpStorm", "phpstorm", ["PhpStorm"]),
  jetbrains("rubymine", "RubyMine", "rubymine", ["RubyMine"]),
  jetbrains("rider", "Rider", "rider", ["Rider"]),
]

/** An editor found, and the command that starts it. */
export type Found = { id: string; name: string; style: Style; command: string }

/** What finding the editors looks at: the machine, or a test's. */
export type Machine = {
  platform: NodeJS.Platform
  home: string
  /** The PATH the window has. */
  path: string | undefined
  /** Whether a program that may be run is at the full `path`. */
  runs: (path: string) => boolean
}

/** The folders a command is looked for in: PATH's, then those an
 * installer puts one in that a window started from the desktop may lack
 * on its PATH, each once. */
export function foldersOf({ platform, home, path }: Machine): string[] {
  const own = (path ?? "").split(delimiter)
  const usual = [
    join(home, ".local/bin"),
    join(home, "bin"),
    "/usr/local/bin",
    "/usr/bin",
    ...(platform === "darwin"
      ? [
          "/opt/homebrew/bin",
          join(home, "Library/Application Support/JetBrains/Toolbox/scripts"),
        ]
      : [
          "/snap/bin",
          "/var/lib/flatpak/exports/bin",
          join(home, ".local/share/flatpak/exports/bin"),
          join(home, ".local/share/JetBrains/Toolbox/scripts"),
        ]),
  ]
  return [...new Set([...own, ...usual].filter((folder) => isAbsolute(folder)))]
}

/** The editors on `machine`, each by the first command found for it, in
 * the order of {@link EDITORS}. */
export function findEditors(machine: Machine): Found[] {
  const folders = foldersOf(machine)
  const whole = (path: string) =>
    path.startsWith("~/") ? join(machine.home, path.slice(2)) : path
  const apps = ["/Applications", join(machine.home, "Applications")]
  return EDITORS.flatMap(({ id, name, style, commands, mac, linux }) => {
    const candidates = [
      ...commands.flatMap((command) =>
        folders.map((folder) => join(folder, command))
      ),
      ...(machine.platform === "darwin"
        ? (mac ?? []).flatMap((inApp) => apps.map((at) => join(at, inApp)))
        : []),
      ...(machine.platform === "linux" ? (linux ?? []).map(whole) : []),
    ]
    const command = candidates.find(machine.runs)
    return command ? [{ id, name, style, command }] : []
  })
}

/** What an editor of `style` is given to open `path` at `line` and
 * `column`. The path is whole, so never read as an option. */
export function argsFor(
  style: Style,
  path: string,
  line: number | null = null,
  column: number | null = null
): string[] {
  const at = line ? (column ? `:${line}:${column}` : `:${line}`) : ""
  switch (style) {
    case "goto":
      return at ? ["--goto", `${path}${at}`] : [path]
    case "line":
      return [
        ...(line ? ["--line", String(line)] : []),
        ...(line && column ? ["--column", String(column)] : []),
        path,
      ]
    case "path":
      return [`${path}${at}`]
  }
}

/** Whether a program that may be run is at `path`. */
function runs(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Starts `command` with `args`, on its own: no shell, its output
 * nowhere, and Banda not waiting on it. Done once it started. */
function launch(command: string, args: readonly string[]): Promise<void> {
  // VS Code's command runs Electron as Node when this is set.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return new Promise((done, fail) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      shell: false,
      env,
    })
    child.once("error", fail)
    child.once("spawn", () => {
      child.unref()
      done()
    })
  })
}

/** The editors on this machine, and opening a file in one (ADR 0073,
 * decision 14). */
export class Editors extends Context.Service<
  Editors,
  {
    /** The editors found, as the page lists them; looked for once. */
    readonly list: Effect.Effect<readonly Found[]>
    /** Opens the file or folder at the whole `path` in editor `id`, at
     * `line` and `column`; refused when either is not there, or the
     * editor did not start. */
    open(
      id: string,
      path: string,
      line: number | null,
      column: number | null
    ): Effect.Effect<void, Refused>
  }
>()("banda/Editors") {
  /** On this machine, as the window finds it. */
  static readonly layer = Layer.effect(Editors)(
    Effect.gen(function* () {
      const list = yield* Effect.cached(
        Effect.sync(() =>
          findEditors({
            platform: process.platform,
            home: homedir(),
            path: process.env.PATH,
            runs,
          })
        )
      )
      return {
        list,
        open: (id, path, line, column) =>
          Effect.gen(function* () {
            const editor = (yield* list).find((one) => one.id === id)
            if (!editor)
              return yield* new Refused({
                message: `No editor ${JSON.stringify(id)} on this computer.`,
              })
            if (!isAbsolute(path) || !statSync(path, { throwIfNoEntry: false }))
              return yield* new Refused({ message: `No such file: ${path}` })
            yield* Effect.tryPromise({
              try: () =>
                launch(
                  editor.command,
                  argsFor(editor.style, path, line, column)
                ),
              catch: (error) =>
                new Refused({
                  message: `${editor.name} did not start: ${String(error)}`,
                }),
            })
          }),
      }
    })
  )
}
