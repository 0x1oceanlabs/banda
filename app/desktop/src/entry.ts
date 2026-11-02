/**
 * An AppImage puts itself in the desktop's list of apps (ADR 0033, step
 * 2). It is one file, anywhere, with no installer: on each start it copies
 * the entry and icon packed inside it to where the desktop looks, with the
 * entry pointing at where the file is now, so one moved, renamed or updated
 * is listed again on its next start. Elsewhere it does nothing.
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { writeWhole } from "@banda/desktop-kit"
import { channel } from "./channel"

/** The packed entry, starting the AppImage at `image` (the spec's quoting). */
export function entryText(packed: string, image: string): string {
  const quoted = `"${image.replace(/["`$\\]/g, (c) => `\\${c}`)}"`
  return packed.replace(/^Exec=.*$/m, `Exec=${quoted} %U\nTryExec=${image}`)
}

/** `to` holds `bytes`, written only when it held something else. */
function keep(to: string, bytes: Buffer): void {
  if (!existsSync(to) || !readFileSync(to).equals(bytes)) writeWhole(to, bytes)
}

/** Lists this AppImage among the desktop's apps; it never stops the start. */
export function listApp(): void {
  const image = process.env.APPIMAGE
  const inside = process.env.APPDIR
  if (!image || !inside) return
  try {
    const data = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
    const name = channel.folder
    const packed = readFileSync(join(inside, `${name}.desktop`), "utf8")
    const entry = Buffer.from(entryText(packed, image))
    keep(join(data, "applications", `${name}.desktop`), entry)
    const icon = `icons/hicolor/512x512/apps/${name}.png`
    keep(join(data, icon), readFileSync(join(inside, "usr/share", icon)))
  } catch (error) {
    console.warn("Banda could not list itself among the desktop's apps:", error)
  }
}
