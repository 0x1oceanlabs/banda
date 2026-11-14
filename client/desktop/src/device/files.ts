/**
 * The files on this device, as the page asks for them on the bridge's
 * `files` (ADR 0073, decision 14): one opened outside Banda or shown in
 * its folder (outside.ts), opened in a code editor found here
 * (editors.ts), dragged out of the window, and a copy of a file's bytes
 * saved here from the machine that has them (bytes.ts; ADR 0106,
 * decision 6).
 *
 * A capability of the device (ADR 0089, decision 9): the table of its
 * answers, beside the code that does each.
 */
import {
  type Answers,
  type Engine,
  none,
  pickSave,
  text,
} from "@banda/desktop-kit"
import { Effect, Schema } from "effect"
import { BrowserWindow } from "electron"
import type { BRIDGE } from "../bridge"
import { saveCopy } from "../bytes"
import { Editors } from "../editors"
import type { Hosts } from "../hosts"
import { dragOut, exists, openFile, showFile } from "../outside"

/** Main's answers to the page's channels of `files`. */
export const filesAnswers: Answers<
  typeof BRIDGE.files,
  Editors | Engine | Hosts
> = {
  outside: [text, ([path]) => openFile(path)],
  show: [text, ([path]) => Effect.sync(() => showFile(path))],
  exists: [text, ([path]) => Effect.sync(() => exists(path))],
  editors: [
    none,
    () =>
      Editors.use((editors) => editors.list).pipe(
        Effect.map((found) => found.map(({ id, name }) => ({ id, name })))
      ),
  ],
  openIn: [
    Schema.Tuple([
      Schema.String,
      Schema.String,
      Schema.NullOr(Schema.Number),
      Schema.NullOr(Schema.Number),
    ]),
    ([editor, path, line, column]) =>
      Editors.use((editors) => editors.open(editor, path, line, column)),
  ],
  drag: [
    Schema.Tuple([Schema.Array(Schema.String)]),
    ([paths], event) => Effect.promise(() => dragOut(event.sender, paths)),
  ],
  save: [
    Schema.Tuple([Schema.String, Schema.String]),
    ([url, name], event) =>
      saveCopy(url, name, (offered) =>
        pickSave(BrowserWindow.fromWebContents(event.sender), offered)
      ),
  ],
}
