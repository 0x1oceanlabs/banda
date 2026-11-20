/**
 * Windows' one notice that Banda still runs (ADR 0136, decision 6): the
 * first time its window hides as it closes, Banda says where it went,
 * as Windows 11 puts a new icon in the notification area's overflow,
 * out of sight. Once ever for this Banda on this machine: that it was
 * said is a file in the window's own folder of Banda's state, written
 * before the notice shows, so a folder that cannot be written says
 * nothing rather than the same at each close. Whether it is said is
 * closing.ts's rule.
 *
 * A part of the device's window (ADR 0089, decision 9), under the
 * windows (windows.ts), which say when the main one hides.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { writeWhole } from "@banda/desktop-kit"
import { app, Notification } from "electron"
import { channel } from "../channel"
import { saysStillRuns } from "../closing"

/** The file that says it was said, in the window's folder. */
export const SAID = "still-runs-said"

/** What the notice says, of the Banda named `name` (Banda, Banda Dev). */
export const stillRuns = (name: string) => ({
  title: `${name} is still running`,
  body: "Its icon is in the notification area, under the arrow if you do not see it. Your Agents work on. Quit Banda is in the icon's menu.",
})

/** The notice shown: kept, or its click would be lost with it. */
let shown: Notification | null = null

/** Says once that Banda still runs, as its window hides on `platform`;
 * a click on the notice does `open`. */
export function sayStillRuns(platform: NodeJS.Platform, open: () => void) {
  // Off Windows nothing is read.
  if (!saysStillRuns(platform, false) || !Notification.isSupported()) return
  const file = join(app.getPath("userData"), SAID)
  if (!saysStillRuns(platform, existsSync(file))) return
  try {
    writeWhole(file, "")
  } catch (error) {
    console.error(`banda: ${file}: ${String(error)}`)
    return
  }
  shown = new Notification({ ...stillRuns(channel.name), silent: true })
  shown.on("click", open)
  shown.show()
}
