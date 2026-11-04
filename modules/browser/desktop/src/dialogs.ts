/** Page dialogs with their native synchronous return values (ADR 0060).
 * Electron's private native edge is confined here; prompt's renderer
 * shim is in preload.ts. */
import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { ipcMain, type IpcMainEvent, type WebContents } from "electron"
import { PROMPT_CHANNEL } from "@banda/browser-pane/desktop"
import type { Dialog } from "@banda/contract/browser"
import { Refused } from "@banda/desktop-kit"
import {
  Context,
  Effect,
  FiberSet,
  Layer,
  Option,
  PubSub,
  Schema,
  Stream,
} from "effect"
import { Tabs } from "./tabs"

const Native = Schema.Struct({
  dialogType: Schema.Literals(["alert", "confirm", "prompt"]),
  messageText: Schema.String,
  defaultPromptText: Schema.String,
  frame: Schema.Struct({ url: Schema.String }),
})
const decode = Schema.decodeUnknownOption(Native)
const promptArgs = Schema.decodeUnknownOption(
  Schema.Tuple([Schema.String, Schema.String])
)
export type DialogChange = {
  tab: number
  dialog: Dialog
  synthetic: boolean
  accepted?: boolean
  text?: string
}

type Pending = {
  synthetic: boolean
  dialog: Dialog
  reply: (accept: boolean, text: string) => void
}

export class Dialogs extends Context.Service<
  Dialogs,
  {
    readonly changes: Stream.Stream<DialogChange>
    watch(tab: number): { opened: Promise<Dialog>; stop: () => void }
    attached(page: WebContents): void
    current(tab: number): Dialog | null
    revision(tab: number): number
    answer(
      tab: number,
      id: string,
      accept: boolean,
      text?: string,
      agent?: string
    ): Effect.Effect<void, Refused>
    replay(tab: number): void
  }
>()("banda/Dialogs") {
  static readonly layer = Layer.effect(Dialogs)(
    Effect.gen(function* () {
      const tabs = yield* Tabs
      const run = yield* FiberSet.makeRuntime()
      const pending = new Map<number, Pending>()
      const changes = yield* PubSub.unbounded<DialogChange>()
      const watchers = new Map<number, Set<(dialog: Dialog) => void>>()
      const publish = (
        tab: number,
        dialog: Dialog,
        accepted?: boolean,
        text?: string,
        synthetic = false
      ) =>
        PubSub.publishUnsafe(changes, {
          tab,
          dialog,
          accepted,
          text,
          synthetic,
        })
      const open = (
        tab: number,
        kind: string,
        message: string,
        defaultPrompt: string,
        url: string,
        reply: Pending["reply"],
        synthetic = false
      ) => {
        if (pending.has(tab)) {
          reply(false, "")
          return
        }
        const dialog: Dialog = {
          id: randomUUID(),
          kind,
          message,
          url,
          default_prompt: defaultPrompt,
        }
        pending.set(tab, { dialog, reply, synthetic })
        tell(tab)
        publish(tab, dialog, undefined, undefined, synthetic)
        for (const heard of watchers.get(tab) ?? []) heard(dialog)
      }
      const revisions = new Map<number, number>()
      const hooks = new Map<number, () => void>()
      const tell = (tab: number) =>
        tabs.tell({
          kind: "dialog",
          from: tab,
          dialog: pending.get(tab)?.dialog ?? null,
        })
      const cancel = (tab: number) => {
        const was = pending.get(tab)
        if (!was) return
        pending.delete(tab)
        tell(tab)
        publish(tab, was.dialog, false, "", was.synthetic)
        was.reply(false, "")
      }
      const prompt = (event: IpcMainEvent, message: unknown, value: unknown) =>
        run(
          Effect.sync(() => {
            const args = Option.getOrUndefined(promptArgs([message, value]))
            if (!hooks.has(event.sender.id) || !args) {
              event.returnValue = null
              return
            }
            open(
              event.sender.id,
              "prompt",
              args[0],
              args[1],
              event.senderFrame?.url ?? event.sender.getURL(),
              (accept, text) => {
                event.returnValue = accept ? text : null
              },
              true
            )
          })
        )
      ipcMain.on(PROMPT_CHANNEL, prompt)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          ipcMain.removeListener(PROMPT_CHANNEL, prompt)
          for (const stop of [...hooks.values()]) stop()
        })
      )
      return {
        changes: Stream.fromPubSub(changes),
        watch: (tab) => {
          let heard: (dialog: Dialog) => void
          const opened = new Promise<Dialog>((resolve) => {
            heard = resolve
          })
          let on = watchers.get(tab)
          if (!on) {
            on = new Set()
            watchers.set(tab, on)
          }
          on.add(heard!)
          return {
            opened,
            stop: () => {
              on.delete(heard!)
              if (!on.size) watchers.delete(tab)
            },
          }
        },
        revision: (tab) => revisions.get(tab) ?? 0,
        current: (tab) => pending.get(tab)?.dialog ?? null,
        replay: tell,
        attached: (page) => {
          if (hooks.has(page.id)) return
          const edge: EventEmitter = page
          const debuggerOf = page.debugger
          const original = edge.listeners("-run-dialog")
          for (const listener of original)
            edge.removeListener(
              "-run-dialog",
              listener as (...args: unknown[]) => void
            )
          const opened = (raw: unknown, callback: unknown) =>
            run(
              Effect.sync(() => {
                if (typeof callback !== "function") return
                const decoded = Option.getOrUndefined(decode(raw))
                if (!decoded || pending.has(page.id)) {
                  callback(false, "")
                  return
                }
                open(
                  page.id,
                  decoded.dialogType,
                  decoded.messageText,
                  decoded.defaultPromptText,
                  decoded.frame.url,
                  (accept, text) => callback(accept, text)
                )
              })
            )
          const nativeIds = new Map<string, string>()
          const heard = (
            _event: unknown,
            method: string,
            _params: unknown,
            session = ""
          ) =>
            run(
              Effect.sync(() => {
                const current = pending.get(page.id)
                if (
                  method === "Page.javascriptDialogOpening" &&
                  current &&
                  !current.synthetic
                )
                  nativeIds.set(session, current.dialog.id)
                if (method !== "Page.javascriptDialogClosed") return
                const id = nativeIds.get(session)
                nativeIds.delete(session)
                if (!current || current.synthetic || current.dialog.id !== id)
                  return
                pending.delete(page.id)
                revisions.set(page.id, (revisions.get(page.id) ?? 0) + 1)
                tell(page.id)
              })
            )
          debuggerOf.on("message", heard)
          const cancelled = () => run(Effect.sync(() => cancel(page.id)))
          const stop = () => {
            cancel(page.id)
            debuggerOf.removeListener("message", heard)
            edge.removeListener("-run-dialog", opened)
            edge.removeListener("-cancel-dialogs", cancelled)
            edge.removeListener("destroyed", gone)
            if (!page.isDestroyed())
              for (const listener of original)
                edge.on("-run-dialog", listener as (...args: unknown[]) => void)
            hooks.delete(page.id)
            revisions.delete(page.id)
          }
          const gone = () => run(Effect.sync(stop))
          edge.on("-run-dialog", opened)
          edge.on("-cancel-dialogs", cancelled)
          edge.once("destroyed", gone)
          hooks.set(page.id, stop)
        },
        answer: (tab, id, accept, text, agent) =>
          Effect.suspend(() => {
            const was = pending.get(tab)
            if (!was || was.dialog.id !== id)
              return Effect.fail(
                new Refused({
                  code: "conflict",
                  message:
                    "That page dialog is no longer open. Take a new snapshot before answering.",
                })
              )
            if (text !== undefined && (!accept || was.dialog.kind !== "prompt"))
              return Effect.fail(
                new Refused({
                  code: "invalid",
                  message: "Only accepting a prompt takes text.",
                })
              )
            pending.delete(tab)
            if (!agent) revisions.set(tab, (revisions.get(tab) ?? 0) + 1)
            tell(tab)
            const value = text ?? was.dialog.default_prompt
            publish(tab, was.dialog, accept, value, was.synthetic)
            was.reply(accept, value)
            return Effect.void
          }),
      }
    })
  )
}
