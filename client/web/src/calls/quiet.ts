/**
 * Quiet (ADR 0098, decision 21; ADR 0099, decision 7): for 30 minutes, an
 * hour, until 9:00 or until turned off, nothing is told: no sound, no
 * toast, no notice on the desktop, and no mark calls. The inbox still
 * fills. It is Banda's own, apart from the desktop's Do Not Disturb.
 *
 * It is this machine's: kept in the device's storage, so a restart keeps
 * it, and every window on the device hears it change. While it is on,
 * `<html data-quiet>` says so, where the marks read it and hold their
 * calls (banda-mark.tsx). When it ends nothing is played back, and the
 * marks call again on their own next beat.
 */
import { type Readable, Store, useStore } from "@banda/core/react"
import { HOUR, MINUTE, wakes } from "@banda/ui/lib/words"
import { dayAt } from "../sidebar/later-time"

/** Quiet until a time, in ms; until it is turned off; or off. */
export type Quiet = number | "on" | "off"

/** Whether `quiet` is on at `now`. */
export function quietAt(quiet: Quiet, now: number): boolean {
  return quiet === "on" || (typeof quiet === "number" && quiet > now)
}

/** The next 9:00 after `now`, by the local clock: today's before 9:00,
 * else tomorrow's. */
export function nineAfter(now: number): number {
  const today = dayAt(now, 0, 9, 0)
  return now < today ? today : dayAt(now, 1, 9, 0)
}

/** What the bell offers at `now`, in the prototype's words; "Until
 * tomorrow 9:00" reads "Until 9:00" before 9:00. */
export function choicesAt(now: number): { words: string; quiet: Quiet }[] {
  const nine = nineAfter(now)
  return [
    { words: "30 minutes", quiet: now + 30 * MINUTE },
    { words: "1 hour", quiet: now + HOUR },
    {
      words:
        nine === dayAt(now, 0, 9, 0) ? "Until 9:00" : "Until tomorrow 9:00",
      quiet: nine,
    },
    { words: "Until I turn it off", quiet: "on" },
  ]
}

/** "Quiet", or "Quiet until 18:30" while it is on until a time. */
export function quietWords(quiet: Quiet, now: number): string {
  return typeof quiet === "number" && quiet > now
    ? `Quiet until ${wakes(quiet, now)}`
    : "Quiet"
}

/** Where the device keeps it: "on", or the time it ends. */
const KEPT = "banda.quiet"

/** What the device's `text` says, at `now`: one past its time is off. */
export function quietOf(text: string | null, now: number): Quiet {
  if (text === "on") return "on"
  const until = Number(text)
  return until > now ? until : "off"
}

/** Where the device keeps Quiet, read as it is asked for. */
export type QuietKept = () => Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>

/** The page that says Quiet: its root, and the window whose `storage`
 * events say another window on the device changed it. The calls part
 * reads no page itself: the page is handed in. */
export type QuietPage = {
  root: Pick<Element, "toggleAttribute">
  events: Pick<Window, "addEventListener" | "removeEventListener">
}

/** One Quiet, kept on the device in `kept`. */
export class Quieting implements Readable<Quiet> {
  readonly #held = new Store<Quiet>("off")
  readonly #kept: QuietKept
  #page: QuietPage | undefined
  #timer: ReturnType<typeof setTimeout> | undefined

  constructor(kept: QuietKept) {
    this.#kept = kept
  }

  readonly get = this.#held.get
  readonly subscribe = this.#held.subscribe

  /** Whether it is on now. */
  readonly on = (): boolean => quietAt(this.get(), Date.now())

  /** Turns it on until a time, or until turned off, or off. */
  readonly turn = (quiet: Quiet): void => {
    try {
      const kept = this.#kept()
      if (quiet === "off") kept.removeItem(KEPT)
      else kept.setItem(KEPT, String(quiet))
    } catch {
      // A device that keeps nothing keeps it for this window's life.
    }
    this.#take(quiet)
  }

  /** Takes what the device keeps, and what another window changes there,
   * and says it on `page`, until the returned stop. */
  follow(page: QuietPage): () => void {
    this.#page = page
    const heard = ({ key }: StorageEvent) => {
      if (key === KEPT || key === null) this.#read()
    }
    page.events.addEventListener("storage", heard)
    this.#read()
    return () => {
      page.events.removeEventListener("storage", heard)
      clearTimeout(this.#timer)
      this.#page = undefined
    }
  }

  #read() {
    let text: string | null = null
    try {
      text = this.#kept().getItem(KEPT)
    } catch {
      // As off.
    }
    this.#take(quietOf(text, Date.now()))
  }

  /**
   * Holds `quiet`, says it on the page's root, and ends it on time. While
   * it lasts it looks again each minute: a timer counts no time the
   * machine sleeps, so one asleep past its end turns Quiet off within a
   * minute of waking.
   */
  #take(quiet: Quiet) {
    clearTimeout(this.#timer)
    this.#timer = undefined
    const now = Date.now()
    const on = quietAt(quiet, now)
    this.#held.set(on ? quiet : "off")
    this.#page?.root.toggleAttribute("data-quiet", on)
    if (!on || typeof quiet !== "number") return
    this.#timer = setTimeout(
      () => (Date.now() < quiet ? this.#take(quiet) : this.turn("off")),
      Math.min(quiet - now, MINUTE)
    )
  }
}

/** This window's Quiet, as the device keeps it. */
export const quiet = new Quieting(() => localStorage)

const same = (value: Quiet) => value

/** This window's Quiet, drawn again as it changes. */
export function useQuiet(): Quiet {
  return useStore(quiet, same)
}
