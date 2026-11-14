/**
 * What the Person picks on this device in the system's own picker, as the
 * page asks on the bridge's `folder`: the folder "Add Project" takes (ADR
 * 0026). The dialog is the kit's (`pickFolder`), over the window that
 * asked.
 *
 * A capability of the device (ADR 0089, decision 9): it holds nothing, so
 * it is a table of answers and no service.
 */
import { type Answers, pickFolder } from "@banda/desktop-kit"
import { Schema } from "effect"
import { BrowserWindow } from "electron"
import type { BRIDGE } from "../bridge"

/** Main's answers to the page's channels of `folder`. */
export const pickAnswers: Answers<typeof BRIDGE.folder, never> = {
  pick: [
    Schema.Tuple([Schema.NullOr(Schema.String)]),
    ([at], event) =>
      pickFolder(BrowserWindow.fromWebContents(event.sender), at),
  ],
}
