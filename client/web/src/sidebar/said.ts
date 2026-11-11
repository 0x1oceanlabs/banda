/**
 * What the sidebar says aloud (spec §2.6, "Announcements"; WCAG 4.1.3):
 * one polite region, `#sb-said`, which the Window mounts empty at boot
 * (`SaidRegion.tsx`), as Chromium skips a region that comes with its words. It
 * speaks only while the focus is in the sidebar or the small inbox;
 * elsewhere the sounds, the toasts and the notices tell (ADR 0011). The
 * calls that come within 2 s are told in one line, and Quiet silences
 * them; inbox zero brought by the Person's own act, and a tab shown by its
 * key, are said at once. Acts and refusals are left to the toasts, which
 * Sonner's own region reads, so nothing is said twice. Pure but for the
 * window's one teller, so plain tests cover it.
 */
import type { Lists } from "@banda/ui/pane"
import { type Stand, standOf } from "@banda/ui/status"
import { callWordOf, type Word } from "./card"
import { zeroSays } from "./Empty"
import type { Tab, Zero } from "./inbox"
import { TAB_WORDS } from "./Tabs"

/** The region's id. */
export const SAID = "sb-said"

/** How long calls gather before one line tells of them, in ms. */
export const GATHER = 2000

/** A call heard: the Thread's key, its title, and its card's word. */
export type Heard = { key: string; title: string; word: Word }

/** What each word says after the title. */
const CALLED: Readonly<Record<Word, string>> = {
  Asks: "asks you.",
  Failed: "failed.",
  Done: "is done.",
  Woke: "woke.",
}

/** The one line that tells of `heard`: the call itself, or how many. */
export function callsSaid(heard: readonly Heard[]): string {
  const [one] = heard
  return heard.length === 1 && one
    ? `${one.title} ${CALLED[one.word]}`
    : `${heard.length} new in Your turn.`
}

/** `words` as sentences: each starts with a capital, ends with a stop. */
const sentences = (words: readonly string[]) =>
  words.map((said) => `${said[0]!.toUpperCase()}${said.slice(1)}.`).join(" ")

/** Inbox zero aloud, in its own words, the middle dots made stops:
 * "Inbox zero. Nothing waits for you. 7 at work. Next wakes at 18:30." */
export function zeroSaid(zero: Zero, now: number): string {
  return sentences([
    "Inbox zero",
    "Nothing waits for you",
    ...zeroSays(zero, now).split(" · "),
    ...(zero.someday === undefined ? [] : [`${zero.someday} someday`]),
  ])
}

/** A tab shown by its key: "Later, 5 Threads". */
export function tabSaid(tab: Tab, count: number): string {
  const many = count === 1 ? "1 Thread" : `${count || "no"} Threads`
  return `${TAB_WORDS[tab]}, ${many}`
}

/** Where a Thread stands, as what is said of it reads it: its place, its
 * title, and in Your turn its call's word. */
export type Standing = { stand: Stand; title: string; word?: Word }

/** Where each Thread of `lists` stands at `now`, by its machine, its
 * Project and its id. */
export function standingsOf(lists: Lists, now: number): Map<string, Standing> {
  const all = new Map<string, Standing>()
  for (const [project, listed] of Object.entries(lists))
    for (const one of listed ?? []) {
      const stand = standOf(one, now)
      const word = stand === "turn" ? callWordOf(one, now) : undefined
      all.set(`${one.host ?? ""}:${project}:${one.id}`, {
        stand,
        title: one.title,
        ...(word ? { word } : {}),
      })
    }
  return all
}

/** Whether a Thread that stood at `was` calls anew at `is`: in Your turn
 * from its work, by another word there, or woke from Later by itself. One
 * from Open or the Archive comes by the Person's own Unread or Unarchive,
 * and a Thread not listed before was there already, its machine's list
 * just come. */
function arrived(was: Standing | undefined, is: Standing): boolean {
  if (!is.word || !was) return false
  switch (was.stand) {
    case "working":
      return true
    case "turn":
      return was.word !== is.word
    case "later":
      return is.word === "Woke"
    default:
      return false
  }
}

/** The calls that came between `before` and `now`. */
export function arrivals(
  before: ReadonlyMap<string, Standing>,
  now: ReadonlyMap<string, Standing>
): Heard[] {
  return [...now].flatMap(([key, is]) =>
    arrived(before.get(key), is)
      ? [{ key, title: is.title, word: is.word! }]
      : []
  )
}

/** What the region hears by: whether the focus is where it speaks, whether
 * Quiet is on, and how it speaks a line. */
export type Ears = {
  listening: () => boolean
  quiet: () => boolean
  speak: (line: string) => void
}

/**
 * The region's teller: calls heard while it listens gather for 2 s from
 * the first, then one line tells of them all, a Thread once, by its last
 * word; Quiet drops them. Any other line is said at once.
 */
export function teller({ listening, quiet, speak }: Ears) {
  let heard: Heard[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  const tell = () => {
    const all = heard
    heard = []
    timer = undefined
    if (all.length > 0 && listening() && !quiet()) speak(callsSaid(all))
  }
  return {
    calls(more: readonly Heard[]) {
      if (more.length === 0 || !listening() || quiet()) return
      const keys = new Set(more.map((one) => one.key))
      heard = [...heard.filter((one) => !keys.has(one.key)), ...more]
      timer ??= setTimeout(tell, GATHER)
    },
    say(line: string) {
      if (listening()) speak(line)
    },
  }
}

/** Where the region speaks: the sidebar, or the small inbox, the counts'
 * list. */
const LISTENS = "aside[data-sidebar], [data-small-inbox]"

let speaking: ReturnType<typeof setTimeout> | undefined

/** The window's one teller, which writes its line into the region React
 * mounted empty: emptied first, so a line said again is heard again.
 * Quiet is `html[data-quiet]`, as the marks will read it (S9d). */
export const said = teller({
  listening: () => document.activeElement?.closest(LISTENS) != null,
  quiet: () => document.documentElement.hasAttribute("data-quiet"),
  speak: (next) => {
    const region = document.getElementById(SAID)
    if (!region) return
    region.textContent = ""
    clearTimeout(speaking)
    speaking = setTimeout(() => (region.textContent = next), 100)
  },
})
