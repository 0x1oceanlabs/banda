/**
 * A tab's page dialog, as the hands meet it (ADR 0060): one is open at
 * most, it stops its page until it is answered, and an answer names it
 * by its ID. Whoever holds the page says which is open: the window from
 * Electron's native edge, the driver from Playwright's (`held`).
 */
import { randomUUID } from "node:crypto"
import type { Dialog } from "@banda/contract/browser"
import type { Page } from "playwright-core"
import { Refusal } from "./refusal"

/** The dialogs of one tab. */
export type Dialogs = {
  /** The dialog its page shows now. */
  current(): Dialog | null
  /** The next dialog its page opens, until `stop`. */
  watch(): { opened: Promise<Dialog>; stop: () => void }
}

/** Why `open`, the dialog a tab shows now, is not answered as asked: it
 * is not the dialog `id` names, or `text` is given to other than a
 * prompt's accept. Nothing when it may be. */
export function unanswerable(
  open: Dialog | null,
  id: string,
  accept: boolean,
  text?: string
): Refusal | undefined {
  if (!open || open.id !== id)
    return new Refusal({
      code: "conflict",
      message:
        "That page dialog is no longer open. Take a new snapshot before answering.",
    })
  if (text !== undefined && (!accept || open.kind !== "prompt"))
    return new Refusal({
      code: "invalid",
      message: "Only accepting a prompt takes text.",
    })
}

/** The page waits for `dialog`, and does nothing else until it is
 * answered; `how` says what the Agent does first. */
export const waitsFor = (dialog: Dialog, how = "Answer it first.") =>
  new Refusal({
    code: "conflict",
    message: `The page waits for dialog ${dialog.id}. ${how}`,
  })

/** The dialogs of `page`, held for an answer as Playwright tells of
 * them: it dismisses one that nothing listens for. */
export function held(page: Page): Dialogs & {
  /** Answers the dialog `id`: accepted with `text`, or the prompt's own
   * when none, or dismissed. */
  answer(id: string, accept: boolean, text?: string): Promise<void>
} {
  let pending:
    | {
        dialog: Dialog
        reply: (accept: boolean, text: string) => Promise<void>
      }
    | undefined
  const watchers = new Set<(dialog: Dialog) => void>()
  page.on("dialog", (opened) => {
    // A page shows one dialog at a time: another is dismissed.
    if (pending) return void opened.dismiss().catch(() => {})
    const dialog: Dialog = {
      id: randomUUID(),
      kind: opened.type(),
      message: opened.message(),
      url: page.url(),
      default_prompt: opened.defaultValue(),
    }
    pending = {
      dialog,
      reply: (accept, text) =>
        accept
          ? opened.accept(dialog.kind === "prompt" ? text : undefined)
          : opened.dismiss(),
    }
    for (const heard of watchers) heard(dialog)
  })
  // A page that closed took its dialog with it.
  page.on("close", () => (pending = undefined))
  return {
    current: () => pending?.dialog ?? null,
    watch: () => {
      let heard: (dialog: Dialog) => void
      const opened = new Promise<Dialog>((resolve) => {
        heard = resolve
      })
      watchers.add(heard!)
      return { opened, stop: () => watchers.delete(heard!) }
    },
    answer: async (id, accept, text) => {
      const refusal = unanswerable(pending?.dialog ?? null, id, accept, text)
      if (refusal) throw refusal
      const was = pending!
      pending = undefined
      await was.reply(accept, text ?? was.dialog.default_prompt)
    },
  }
}
