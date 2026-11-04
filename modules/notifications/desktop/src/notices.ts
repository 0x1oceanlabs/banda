/**
 * The desktop's side of Banda's notifications (ADR 0011, decisions 3 and
 * 4; ADR 0056): it shows a system notification the module's window part
 * asks for, takes it back, says when the Person clicks it, and reads
 * whether the desktop is quiet. The window part decides what to say and
 * when; this only speaks to the desktop.
 */
import type { Notice } from "@banda/notifications-pane/desktop"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Notification, nativeImage } from "electron"

/** A notice the window part asks the desktop to show. */
export const NoticeArg = Schema.Struct({
  key: Schema.String,
  title: Schema.String,
  body: Schema.optional(Schema.String),
  icon: Schema.optional(Schema.String),
  answer: Schema.String,
  lasts: Schema.Boolean,
}) satisfies Schema.Decoder<Notice>

export class Notices extends Context.Service<
  Notices,
  {
    /** Shows `notice`, replacing the last of its key; `answered` hears a
     * click on it. */
    show(notice: Notice, answered: (key: string) => void): Effect.Effect<void>
    /** Takes the notice of `key` back. */
    withdraw(key: string): Effect.Effect<void>
    /** Whether the desktop is quiet now. */
    readonly quiet: Effect.Effect<boolean>
  }
>()("banda/Notices") {
  /**
   * The Person's desktop: its notification server, through Electron, and
   * Omarchy's Do Not Disturb, when Omarchy is there.
   */
  static readonly system = Layer.effect(Notices)(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const shown = new Map<string, Notification>()
      const withdraw = (key: string) =>
        Effect.sync(() => {
          const notification = shown.get(key)
          shown.delete(key)
          notification?.close()
        })
      // Whether Omarchy's Do Not Disturb is on, read at most every two
      // seconds. A desktop without Omarchy, or one that does not answer
      // quickly, is not quiet.
      const quiet = yield* Effect.cachedWithTTL(
        spawner
          .string(
            ChildProcess.make("omarchy-shell", ["notifications", "isDnd"])
          )
          .pipe(
            Effect.map((said) => said.trim() === "on"),
            Effect.timeout("500 millis"),
            Effect.orElseSucceed(() => false)
          ),
        "2 seconds"
      )
      return {
        withdraw,
        quiet,
        show: (notice, answered) =>
          Effect.andThen(
            withdraw(notice.key),
            Effect.sync(() => {
              const notification = new Notification({
                title: notice.title,
                body: notice.body ?? "",
                // Banda plays its own sound (ADR 0009).
                silent: true,
                icon: notice.icon
                  ? nativeImage.createFromDataURL(notice.icon)
                  : undefined,
                // A call that waits for the Person stays until they see it.
                timeoutType: notice.lasts ? "never" : "default",
                urgency: "normal",
                actions: [{ type: "button", text: notice.answer }],
              })
              const answer = () => {
                shown.delete(notice.key)
                answered(notice.key)
              }
              notification.on("click", answer)
              notification.on("action", answer)
              notification.on("close", () => {
                if (shown.get(notice.key) === notification)
                  shown.delete(notice.key)
              })
              shown.set(notice.key, notification)
              notification.show()
            })
          ),
      }
    })
  )

  /** `desktop`, for the end-to-end tests. */
  static readonly recorded = (desktop: RecordedDesktop) =>
    Layer.succeed(Notices)({
      show: (notice, answered) =>
        Effect.sync(() => desktop.show(notice, answered)),
      withdraw: (key) => Effect.sync(() => desktop.withdraw(key)),
      quiet: Effect.sync(() => desktop.isQuiet),
    })
}

/**
 * A desktop that keeps what it was asked to show, for the end-to-end
 * tests: they read it, click it and turn the quiet on through
 * `globalThis.bandaDesktop`, and nothing reaches the Person's screen.
 */
export class RecordedDesktop {
  readonly shown: Notice[] = []
  readonly withdrawn: string[] = []
  isQuiet = false
  #answers = new Map<string, (key: string) => void>()

  show(notice: Notice, answered: (key: string) => void) {
    this.shown.push(notice)
    this.#answers.set(notice.key, answered)
  }

  withdraw(key: string) {
    this.withdrawn.push(key)
    this.#answers.delete(key)
  }

  /** The Person clicks the notice of `key`. */
  click(key: string) {
    const answered = this.#answers.get(key)
    this.#answers.delete(key)
    answered?.(key)
  }
}
