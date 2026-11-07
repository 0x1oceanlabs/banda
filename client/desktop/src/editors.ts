/**
 * The code editors on this machine, and how a file opens in one at its
 * line (ADR 0073, decisions 10 and 14), as T3 Code lists and launches them
 * (docs/research/2026-11-04-files.md, §1): Cursor, VS Code and its
 * Insiders, VSCodium, Windsurf, Zed, Sublime Text and the JetBrains IDEs.
 *
 * An editor is found by its command, on PATH or in the folders its
 * installer uses, then by its app's own copy of the command: in an
 * Applications folder on macOS, in /opt or /usr/share on Linux. On
 * Windows it is found by its own program, on PATH, beside it or where
 * its installer puts it (ADR 0090, decision 7). What is found is kept for
 * the run. An editor starts on its own, apart from Banda, with the path
 * as one argument and no shell between.
 *
 * Banda's own text files, as its `.toml` settings, open where the Person
 * edits text: on Windows, which has no app for a `.toml`, in the first
 * editor found, or else in Notepad.
 */
import { spawn } from "node:child_process"
import { accessSync, constants, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { posix, win32 } from "node:path"
import { onThisMachine, onThisMachineOn, Refused } from "@banda/desktop-kit"
import { Context, Effect, Layer } from "effect"
import { shell } from "electron"

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
  /** Its own program on Windows, and the folders its installers put it
   * in, each under a folder of programs (`Machine.programs`). Node starts
   * a `.cmd`, as VS Code's `code.cmd`, only through a shell, so the
   * program is the app's own. A name that ends with `*` goes on with a
   * version: the newest found comes first. */
  windows?: { exe: string; in: readonly string[] }
}

/** Where a VS Code-like app keeps its command on macOS. */
const vscodeApp = (app: string, command: string) =>
  `${app}.app/Contents/Resources/app/bin/${command}`

/** A JetBrains IDE: its command is its launcher, in its app on macOS and
 * among the Toolbox's scripts anywhere. On Windows it is its 64-bit
 * program, in a folder of each version, whether the Toolbox or its own
 * installer put it there. */
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
  windows: {
    exe: `${command}64.exe`,
    in: apps.flatMap((app) => [`${app}*/bin`, `JetBrains/${app}*/bin`]),
  },
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
    windows: { exe: "Cursor.exe", in: ["cursor"] },
  },
  {
    id: "vscode",
    name: "VS Code",
    style: "goto",
    commands: ["code", "com.visualstudio.code"],
    mac: [vscodeApp("Visual Studio Code", "code")],
    linux: ["/usr/share/code/bin/code", "/opt/visual-studio-code/bin/code"],
    windows: { exe: "Code.exe", in: ["Microsoft VS Code"] },
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
    windows: { exe: "Code - Insiders.exe", in: ["Microsoft VS Code Insiders"] },
  },
  {
    id: "vscodium",
    name: "VSCodium",
    style: "goto",
    commands: ["codium", "com.vscodium.codium"],
    mac: [vscodeApp("VSCodium", "codium")],
    linux: ["/usr/share/codium/bin/codium", "/opt/vscodium-bin/bin/codium"],
    windows: { exe: "VSCodium.exe", in: ["VSCodium"] },
  },
  {
    id: "windsurf",
    name: "Windsurf",
    style: "goto",
    commands: ["windsurf"],
    mac: [vscodeApp("Windsurf", "windsurf")],
    linux: ["/usr/share/windsurf/bin/windsurf", "/opt/Windsurf/bin/windsurf"],
    windows: { exe: "Windsurf.exe", in: ["Windsurf"] },
  },
  {
    id: "zed",
    name: "Zed",
    style: "path",
    // Arch and Fedora name it zeditor and zedit; its own installer, zed.
    commands: ["zed", "zeditor", "zedit", "dev.zed.Zed"],
    mac: ["Zed.app/Contents/MacOS/cli"],
    linux: ["~/.local/zed.app/bin/zed"],
    // Its command, which goes to a line; the app itself is Zed.exe.
    windows: { exe: "zed.exe", in: ["Zed/bin"] },
  },
  {
    id: "sublime",
    name: "Sublime Text",
    style: "path",
    commands: ["subl", "sublime_text", "com.sublimetext.three"],
    mac: ["Sublime Text.app/Contents/SharedSupport/bin/subl"],
    linux: ["/opt/sublime_text/sublime_text"],
    windows: { exe: "subl.exe", in: ["Sublime Text", "Sublime Text 3"] },
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
  // Its own installer names its folder JetBrains Rider.
  jetbrains("rider", "Rider", "rider", ["Rider", "JetBrains Rider"]),
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
  /** Windows' folders of programs: `%LOCALAPPDATA%\Programs`, where a
   * per-user installer puts an app, and `%ProgramFiles%`. */
  programs?: readonly string[]
  /** The names in `folder`; none when it cannot be read. */
  list?: (folder: string) => readonly string[]
}

/** Windows' folders of apps from its store: the programs on PATH there
 * are stubs that may start the store or an install (ADR 0090, decision
 * 2), so Banda never looks for one there. */
const ALIASES = /[\\/]WindowsApps([\\/]|$)/i

/** The folders a command is looked for in: PATH's, then those an
 * installer puts one in that a window started from the desktop may lack
 * on its PATH, each once. On Windows, only PATH's on a drive. */
export function foldersOf({ platform, home, path }: Machine): string[] {
  if (platform === "win32")
    return [
      ...new Set(
        (path ?? "")
          .split(win32.delimiter)
          .filter(
            (folder) =>
              onThisMachineOn(platform)(folder) && !ALIASES.test(folder)
          )
      ),
    ]
  const { join } = posix
  const own = (path ?? "").split(posix.delimiter)
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
  return [
    ...new Set([...own, ...usual].filter((folder) => posix.isAbsolute(folder))),
  ]
}

/** The editors on `machine`, each by the first command found for it, in
 * the order of {@link EDITORS}. */
export function findEditors(machine: Machine): Found[] {
  if (machine.platform === "win32") return onWindows(machine)
  const { join } = posix
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

/** The editors on a Windows `machine`: each by its own program, on PATH or
 * beside a PATH folder named `bin`, as VS Code puts `bin\code.cmd` on
 * PATH beside its app, then where its installers put it. */
function onWindows(machine: Machine): Found[] {
  const { join } = win32
  const folders = foldersOf(machine)
  const programs = (machine.programs ?? []).filter(onThisMachineOn("win32"))
  // A folder of programs is read once, however many editors look in it.
  const listed = new Map<string, readonly string[]>()
  const list = (folder: string) => {
    if (!listed.has(folder)) listed.set(folder, machine.list?.(folder) ?? [])
    return listed.get(folder)!
  }
  /** The folders `place` names under `base`, its versions newest first.
   * Windows' names are the same in any case. */
  const under = (base: string, place: string): string[] =>
    place.split("/").reduce<string[]>(
      (bases, part) =>
        bases.flatMap((at) =>
          part.endsWith("*")
            ? list(at)
                .filter((one) =>
                  one.toLowerCase().startsWith(part.slice(0, -1).toLowerCase())
                )
                .sort((a, b) => b.localeCompare(a, "en", { numeric: true }))
                .map((one) => join(at, one))
            : [join(at, part)]
        ),
      [base]
    )
  return EDITORS.flatMap(({ id, name, style, windows }) => {
    if (!windows) return []
    const onPath = folders.flatMap((folder) => [
      join(folder, windows.exe),
      ...(/[\\/]bin[\\/]?$/i.test(folder)
        ? [join(folder, "..", windows.exe)]
        : []),
    ])
    // Its installers' folders are read only for one not found on PATH.
    const installed = () =>
      programs.flatMap((base) =>
        windows.in.flatMap((place) =>
          under(base, place).map((folder) => join(folder, windows.exe))
        )
      )
    const command = onPath.find(machine.runs) ?? installed().find(machine.runs)
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

/** The names in `folder`; none when it cannot be read. */
function namesIn(folder: string): string[] {
  try {
    return readdirSync(folder)
  } catch {
    return []
  }
}

/** Windows' Notepad, where a text file opens with no editor found. */
const notepad = () =>
  win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "notepad.exe")

/** Whether the system has no app for the file at `path`, so it opens in
 * an editor: a `.toml` on Windows. */
export function noAppFor(
  path: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === "win32" && /\.toml$/i.test(path)
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
    /** Opens the text file at the whole `path` for the Person to edit, as
     * one of Banda's `.toml` files: in the system's app for it, or where
     * the system has none (`noAppFor`), in the first editor found, else in
     * Notepad. Refused when it did not open. */
    edit(path: string): Effect.Effect<void, Refused>
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
            programs: [
              process.env.LOCALAPPDATA &&
                win32.join(process.env.LOCALAPPDATA, "Programs"),
              process.env.ProgramFiles,
              process.env["ProgramFiles(x86)"],
            ].filter((folder) => !!folder) as string[],
            list: namesIn,
          })
        )
      )
      /** Starts `command` with `args`, or says why it did not. */
      const started = (name: string, command: string, args: string[]) =>
        Effect.tryPromise({
          try: () => launch(command, args),
          catch: (error) =>
            new Refused({ message: `${name} did not start: ${String(error)}` }),
        })
      return {
        list,
        edit: (path) =>
          Effect.gen(function* () {
            if (!noAppFor(path)) {
              const failed = yield* Effect.promise(() => shell.openPath(path))
              if (failed) return yield* new Refused({ message: failed })
              return
            }
            const [first] = yield* list
            yield* first
              ? started(first.name, first.command, argsFor(first.style, path))
              : started("Notepad", notepad(), [path])
          }),
        open: (id, path, line, column) =>
          Effect.gen(function* () {
            const editor = (yield* list).find((one) => one.id === id)
            if (!editor)
              return yield* new Refused({
                message: `No editor ${JSON.stringify(id)} on this computer.`,
              })
            if (
              !onThisMachine(path) ||
              !statSync(path, { throwIfNoEntry: false })
            )
              return yield* new Refused({ message: `No such file: ${path}` })
            yield* started(
              editor.name,
              editor.command,
              argsFor(editor.style, path, line, column)
            )
          }),
      }
    })
  )
}
