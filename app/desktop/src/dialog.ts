/** The Person's yes or no, in a dialog of the desktop's. */
import { Effect } from "effect"
import { type BrowserWindow, dialog } from "electron"

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
