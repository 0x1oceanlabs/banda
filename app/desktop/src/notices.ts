/**
 * The desktop's side of Banda's calls (ADR 0011, decisions 3 and 4): it
 * shows a system notification the page asks for, takes it back, says when
 * the Person clicks it, and reads whether the desktop is quiet. The page
 * decides what to say and when; this only speaks to the desktop.
 */
import { execFile } from "node:child_process"
import { Notification, nativeImage } from "electron"
import type { Notice } from "@banda/web/host"

/** What shows the page's notices, and hears the desktop's quiet. */
export interface Desktop {
  show(notice: Notice, answered: (key: string) => void): void
  withdraw(key: string): void
  quiet(): Promise<boolean>
}

/** How long a reading of the desktop's quiet holds, in ms. */
const QUIET_HOLDS = 2000

/**
 * The Person's desktop: its notification server, through Electron, and
 * Omarchy's Do Not Disturb, when Omarchy is there.
 */
export class SystemDesktop implements Desktop {
  readonly #shown = new Map<string, Notification>()
  #quiet: { at: number; is: Promise<boolean> } | undefined

  show(notice: Notice, answered: (key: string) => void) {
    this.withdraw(notice.key)
    const shown = new Notification({
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
      this.#shown.delete(notice.key)
      answered(notice.key)
    }
    shown.on("click", answer)
    shown.on("action", answer)
    shown.on("close", () => {
      if (this.#shown.get(notice.key) === shown) this.#shown.delete(notice.key)
    })
    this.#shown.set(notice.key, shown)
    shown.show()
  }

  withdraw(key: string) {
    const shown = this.#shown.get(key)
    if (!shown) return
    this.#shown.delete(key)
    shown.close()
  }

  quiet(): Promise<boolean> {
    const now = Date.now()
    if (this.#quiet && now - this.#quiet.at < QUIET_HOLDS) return this.#quiet.is
    const is = omarchyQuiet()
    this.#quiet = { at: now, is }
    return is
  }
}

/**
 * Whether Omarchy's Do Not Disturb is on. A desktop without Omarchy, or
 * one that does not answer quickly, is not quiet.
 */
function omarchyQuiet(): Promise<boolean> {
  return new Promise((done) => {
    execFile(
      "omarchy-shell",
      ["notifications", "isDnd"],
      { timeout: 500 },
      (failed, out) => done(!failed && String(out).trim() === "on")
    )
  })
}

/**
 * A desktop that keeps what it was asked to show, for the end-to-end
 * tests: they read it, click it and turn the quiet on through
 * `globalThis.bandaDesktop`, and nothing reaches the Person's screen.
 */
export class RecordedDesktop implements Desktop {
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

  quiet() {
    return Promise.resolve(this.isQuiet)
  }

  /** The Person clicks the notice of `key`. */
  click(key: string) {
    const answered = this.#answers.get(key)
    this.#answers.delete(key)
    answered?.(key)
  }
}
