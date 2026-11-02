/** The desktop's dialogs: the Person's yes or no, and a folder they pick. */
import { Effect } from "effect"
import { app, type BrowserWindow, dialog } from "electron"

/** What a yes or no asks, and the words of its two buttons. */
export type Ask = { message: string; detail: string; yes: string; no: string }

/** Asks the Person `ask`, over `window` when there is one; no is the
 * default. */
export const confirm = (window: BrowserWindow | null, ask: Ask) =>
  Effect.promise(async () => {
    const options = {
      type: "question" as const,
      message: ask.message,
      detail: ask.detail,
      buttons: [ask.yes, ask.no],
      defaultId: 1,
      cancelId: 1,
    }
    const { response } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)
    return response === 0
  })

/** The folder the Person picks in the system's picker, over `window`,
 * opened at `at`, a whole path, or home; none if they cancel. On Hyprland
 * the desktop portal draws it. */
export const pickFolder = (window: BrowserWindow | null, at: string | null) =>
  Effect.promise(async () => {
    const options = {
      properties: ["openDirectory" as const, "createDirectory" as const],
      defaultPath: at ?? app.getPath("home"),
    }
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return canceled ? null : (filePaths[0] ?? null)
  })
