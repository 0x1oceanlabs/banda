/**
 * A file the page opens outside Banda, as a path a Person Ctrl-clicks in a
 * terminal: in the app the system has for it. A program is only shown in
 * its folder, so a click never runs it: on Windows, which marks none, a
 * file of a kind Windows runs as it opens (ADR 0090, decision 7). A
 * `.toml`, which stock Windows has no app for, opens in an editor
 * (`Editors.edit`). A path off this machine is never looked at
 * (`onThisMachine`). And files dragged out of the window, as the files
 * themselves (ADR 0073, decision 10).
 */
import { type Stats, statSync } from "node:fs"
import { win32 } from "node:path"
import { onThisMachine } from "@banda/desktop-kit"
import { Effect } from "effect"
import {
  app,
  nativeImage,
  type NativeImage,
  shell,
  type WebContents,
} from "electron"
import { Editors } from "./editors"

/** Opens the file at the full `path`; nothing for any other. */
export const openFile = (path: string) =>
  Effect.suspend(() => {
    const found = here(path)
    if (!found) return Effect.void
    if (runs(found, path))
      return Effect.sync(() => shell.showItemInFolder(path))
    return Editors.use((editors) => Effect.ignore(editors.edit(path)))
  })

/** Whether a file or a folder is at the full `path`. */
export function exists(path: string): boolean {
  return !!here(path)
}

/** Shows the file at the full `path` in its folder; nothing for any
 * other. */
export function showFile(path: string): void {
  if (here(path)) shell.showItemInFolder(path)
}

/** What is at the full `path` on this machine; none for any other. */
function here(path: string): Stats | undefined {
  return onThisMachine(path)
    ? statSync(path, { throwIfNoEntry: false })
    : undefined
}

/**
 * The kinds of file Windows runs as it opens them, or that run what is in
 * them once a common app is there (Git Bash, Python, Ruby, AutoHotkey,
 * Java, Office's macros), or that change the system, install something or
 * reach the network, beside those `PATHEXT` names: Outlook blocks most of
 * them as attachments.
 */
const RUNS_ON_WINDOWS = new Set(
  [
    "exe com scr pif bat cmd btm ps1 psm1 psd1 ps1xml psc1 psc2",
    "vbs vbe vb js jse ws wsf wsh wsc sct hta jar jnlp job",
    "py pyw pyz pyzw pyc pyo pl rb rbw sh bash ahk",
    "msi msp mst msu msix msixbundle appx appxbundle appinstaller",
    "application appref-ms gadget xbap vsix vsto cpl msc reg inf ins isp",
    "lnk url website scf settingcontent-ms library-ms search-ms",
    "searchconnector-ms theme themepack deskthemepack diagcab wsb rdp",
    "cer crt der p7b pfx p12 iqy chm hlp shb shs",
    "xll xla xlam xlsm xltm xlsb docm dotm pptm potm ppsm ppam sldm",
    "mde mdb ade adp accde iso img vhd vhdx",
  ]
    .join(" ")
    .split(" ")
    .map((kind) => `.${kind}`)
)

/** Whether opening the file could run it: a program, or a macOS app; on
 * Windows, a file of a kind it runs. */
export function runs(
  found: Pick<Stats, "isDirectory" | "mode">,
  path: string,
  platform: NodeJS.Platform = process.platform,
  pathext = process.env.PATHEXT
): boolean {
  if (found.isDirectory()) return path.endsWith(".app")
  if (platform !== "win32") return (found.mode & 0o111) !== 0
  return runsOnWindows(path, pathext)
}

/** Whether the file at `path` is of a kind Windows runs, by its name as
 * Windows reads it. */
function runsOnWindows(path: string, pathext = process.env.PATHEXT) {
  // Windows drops a name's last dots and spaces, `x.bat. ` is `x.bat`, and
  // reads a name that starts with its dot, `.exe`, as a kind alone.
  const name = win32.basename(path).replace(/[. ]+$/, "")
  const dot = name.lastIndexOf(".")
  if (dot < 0) return false
  const kind = name.slice(dot).toLowerCase()
  const named = (pathext ?? "").toLowerCase().split(";")
  return RUNS_ON_WINDOWS.has(kind) || named.includes(kind)
}

/** The most files one drag carries. */
const DRAGGED = 200

/** Drags the files at the whole `paths` out of `contents`, as the files
 * themselves, under the system's icon for the first: a folder's path may
 * end with `/`. Any not there are left out. */
export async function dragOut(
  contents: WebContents,
  paths: readonly string[]
): Promise<void> {
  const files = paths
    .slice(0, DRAGGED)
    .map((path) => path.replace(/(.)\/+$/, "$1"))
    .filter(exists)
  if (files.length === 0) return
  // A shortcut's or a library's icon on Windows may be on a share, which a
  // look at it reaches: a file of a kind that runs goes under a sheet.
  const icon =
    process.platform === "win32" && runsOnWindows(files[0])
      ? null
      : await app.getFileIcon(files[0], { size: "normal" }).catch(() => null)
  contents.startDrag({
    file: files[0],
    files,
    icon: icon && !icon.isEmpty() ? icon : sheet(),
  })
}

/** A plain sheet of paper, 24 px by 32, for a drag where the system has
 * no icon: Electron starts none without one. */
function sheet(): NativeImage {
  const [width, height] = [24, 32]
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 2; y < height - 2; y++)
    for (let x = 3; x < width - 3; x++) {
      const at = (y * width + x) * 4
      const edge = y === 2 || y === height - 3 || x === 3 || x === width - 4
      // BGRA: a light grey sheet with a darker edge.
      pixels.fill(edge ? 0x80 : 0xe8, at, at + 3)
      pixels[at + 3] = 0xff
    }
  return nativeImage.createFromBitmap(pixels, { width, height })
}
