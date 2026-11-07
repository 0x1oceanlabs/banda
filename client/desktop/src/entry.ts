/**
 * An AppImage puts itself in the desktop's list of apps (ADR 0033, step
 * 2). It is one file, anywhere, with no installer: on each start it copies
 * the entry and icon packed inside it to where the desktop looks, with the
 * entry pointing at where the file is now, so one moved, renamed or updated
 * is listed again on its next start. Elsewhere it does nothing.
 *
 * On Windows Banda Local, which no installer lists, makes its own shortcut
 * in the Start menu, which carries its app ID: Windows shows no notice of
 * an app without one (ADR 0090, decision 7).
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, win32 } from "node:path"
import { writeWhole } from "@banda/desktop-kit"
import { app, shell, type ShortcutDetails } from "electron"
import { CHANNELS, channel, DESCRIPTION } from "./channel"

/** The packed entry, starting the AppImage at `image` (the spec's quoting). */
export function entryText(packed: string, image: string): string {
  const quoted = `"${image.replace(/["`$\\]/g, (c) => `\\${c}`)}"`
  return packed.replace(/^Exec=.*$/m, `Exec=${quoted} %U\nTryExec=${image}`)
}

/** `to` holds `bytes`, written only when it held something else. */
function keep(to: string, bytes: Buffer): void {
  if (!existsSync(to) || !readFileSync(to).equals(bytes)) writeWhole(to, bytes)
}

/** Where the desktop looks for apps' entries and icons. */
const dataHome = () =>
  process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")

/** This Banda's entry among the desktop's apps. */
const entryAt = () =>
  join(dataHome(), "applications", `${channel.folder}.desktop`)

/** Banda Local's shortcut on Windows: in the Start menu under Electron's
 * `appData`, starting this Electron on the checkout's window at `window`,
 * under its app ID. */
export function shortcutOf(
  appData: string,
  electron: string,
  window: string
): { path: string; link: ShortcutDetails } {
  return {
    path: win32.join(
      appData,
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      `${channel.name}.lnk`
    ),
    link: {
      target: electron,
      args: `"${window}"`,
      description: DESCRIPTION,
      appUserModelId: channel.appId,
    },
  }
}

/** Makes Banda Local's shortcut, or makes it again when it names another
 * Electron, checkout or app ID; on Windows only, once the app is ready, as
 * the shell's calls need it. A Banda an installer put there has its own. */
export function listShortcut(): void {
  if (process.platform !== "win32" || channel !== CHANNELS.local) return
  const { path, link } = shortcutOf(
    app.getPath("appData"),
    process.execPath,
    app.getAppPath()
  )
  let made: ShortcutDetails | undefined
  try {
    made = shell.readShortcutLink(path)
  } catch {
    // None yet.
  }
  const same =
    made?.target === link.target &&
    made.args === link.args &&
    made.appUserModelId === link.appUserModelId
  // `create` makes it, or writes it over the one there.
  if (!same && !shell.writeShortcutLink(path, "create", link))
    console.warn(`Banda could not make its shortcut at ${path}`)
}

/** Lists this AppImage among the desktop's apps, or the one at `image`
 * that an update moved in (ADR 0041, decision 3); it never stops the
 * start. */
export function listApp(image = process.env.APPIMAGE): void {
  const inside = process.env.APPDIR
  if (!image || !inside) return
  try {
    const data = dataHome()
    const name = channel.folder
    const packed = readFileSync(join(inside, `${name}.desktop`), "utf8")
    const entry = Buffer.from(entryText(packed, image))
    keep(entryAt(), entry)
    const icon = `icons/hicolor/512x512/apps/${name}.png`
    keep(join(data, icon), readFileSync(join(inside, "usr/share", icon)))
  } catch (error) {
    console.warn("Banda could not list itself among the desktop's apps:", error)
  }
}

/** The AppImage this Banda's entry starts: the last one that started, or
 * that an update moved in; none without an entry. */
export function listedImage(): string | undefined {
  try {
    return /^TryExec=(.+)$/m.exec(readFileSync(entryAt(), "utf8"))?.[1]
  } catch {
    return undefined
  }
}
