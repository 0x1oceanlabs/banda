/**
 * The device's clipboard, as the page asks for it on the bridge's `edit`:
 * the page never reads the clipboard itself, so a paste is the system's
 * own into the field that has the focus, and "Copy image" is the system's
 * copy of the image at a point (ADR 0063, decision 3).
 *
 * A capability of the device (ADR 0089, decision 9): it holds nothing, so
 * it is a table of answers and no service.
 */
import { type Answers, none } from "@banda/desktop-kit"
import { Effect, Schema } from "effect"
import type { BRIDGE } from "../bridge"

/** Main's answers to the page's channels of `edit`. */
export const clipboardAnswers: Answers<typeof BRIDGE.edit, never> = {
  paste: [none, (_, event) => Effect.sync(() => event.sender.paste())],
  pastePlain: [
    none,
    (_, event) => Effect.sync(() => event.sender.pasteAndMatchStyle()),
  ],
  copyImageAt: [
    Schema.Tuple([Schema.Number, Schema.Number]),
    ([x, y], event) =>
      Effect.sync(() => event.sender.copyImageAt(Math.round(x), Math.round(y))),
  ],
}
