/**
 * What the notifications module does with what calls in the lists (ADR
 * 0011, ADR 0056, decision 1): it finds what is news, gathers it for a
 * moment, plays the loudest sound (ADR 0009) and tells of each call where
 * the Person will notice it: a toast, or a system notification. A call
 * that stops, or that the Person looks at, takes them back.
 */
import { toast, toastUnseen } from "@banda/ui/components/sonner"
import type { WindowApi } from "@banda/ui/module"
import { type Call, callsOf, type Lists } from "@banda/ui/pane"
import { type Chime, player } from "@banda/ui/sound"
import { type Desktop, desktopOf } from "./desktop"
import { GATHER, loudestChime, type Played, plays } from "./sound"
import {
  iconOf,
  loudestOf,
  MANY,
  noticeOf,
  quietNow,
  SUMMARY,
  summaryOf,
} from "./system"
import { newsOf, placeOf, tell } from "./tell"
import { toastCall, toastTold } from "./toast"
import { type Button, clicked, type Told } from "./told"

/** What tells: what calls, from the lists, and what a module tells. */
export type Teller = {
  /** Tells what a module told, where the Person will notice it. */
  told: (told: Told) => Promise<void>
  stop: () => void
}

/** Starts telling. */
export function startTelling(
  window: WindowApi,
  desktop: Desktop | undefined = desktopOf()
): Teller {
  let calling: readonly Call[] = []
  // The Spaces already listed: a Space's first list is what already was.
  let known = new Set<string>()
  let gathered: Call[] = []
  let last: Played | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  // The toasts up, and the notices the desktop shows: one per thing, and
  // one for many.
  const toasted = new Set<string>()
  const noticed = new Set<string>()
  const summarized = new Set<string>()

  const withdraw = (keys: Iterable<string>) => {
    const had = summarized.size
    for (const key of keys) {
      if (toasted.delete(key)) toast.dismiss(key)
      if (noticed.delete(key)) desktop?.withdraw(key)
      summarized.delete(key)
    }
    if (had > 0 && summarized.size === 0) desktop?.withdraw(SUMMARY)
  }
  // What modules told on the desktop, by key: a click runs its button.
  const toldThere = new Map<string, Told>()
  const press = (button: Button) => window.run(button.action, button.args)
  const sounds = (chime: Chime) => {
    const at = performance.now()
    if (!plays(last, chime, at)) return
    last = { chime, at }
    player.play(chime, window.look().sound)
  }
  const told = async (told: Told) => {
    const { notify } = window.look()
    const place = placeOf(
      window.sight(),
      notify,
      await quietNow(notify, desktop)
    )
    if (!place) return
    if (!told.silent) sounds(told.kind)
    if (place.toast) toastTold(told, press)
    if (!place.system) return
    toastUnseen((options) => toastTold(told, press, options))
    if (!desktop) return
    toldThere.set(told.key, told)
    desktop.show({
      key: told.key,
      title: told.title,
      ...((told.notice ?? told.body) ? { body: told.notice ?? told.body } : {}),
      answer: clicked(told)?.label ?? "Open",
      lasts: told.kind === "asking",
    })
  }
  const answer = (call: Call) => {
    window.goTo(call)
    withdraw([call.key])
  }

  const tellNews = async () => {
    timer = undefined
    const news = new Map(gathered.map((call) => [call.key, call]))
    gathered = []
    const { notify } = window.look()
    const quiet = await quietNow(notify, desktop)
    const chimes: Chime[] = []
    const notices: Call[] = []
    for (const call of news.values()) {
      const telling = tell(call.chime, window.sight(call), notify, quiet)
      if (telling.sound) chimes.push(call.chime)
      if (telling.toast) {
        toasted.add(call.key)
        toastCall(call, notify.detail, answer)
      }
      if (telling.system) {
        notices.push(call)
        // Kept with the toasts unseen, so the bell shows it again (ADR
        // 0048, decision 2).
        toastUnseen((options) =>
          toastCall(call, notify.detail, answer, options)
        )
      }
    }
    const chime = loudestChime(chimes)
    if (chime) sounds(chime)
    if (!desktop || notices.length === 0) return
    if (notices.length > MANY) {
      for (const call of notices) summarized.add(call.key)
      const icon = await iconOf(loudestOf(notices))
      desktop.show({ ...summaryOf(notices), ...(icon ? { icon } : {}) })
      return
    }
    for (const call of notices) {
      noticed.add(call.key)
      const icon = await iconOf(call.chime)
      desktop.show({
        ...noticeOf(call, notify.detail),
        ...(icon ? { icon } : {}),
      })
    }
  }

  // What the Person looks at is seen: its toast and notification go,
  // while the call may still wait for them, as a Question does.
  const seen = () =>
    withdraw(
      calling
        .filter((call) => window.sight(call) === "looking")
        .map((call) => call.key)
    )

  const heard = (lists: Lists) => {
    const now = callsOf(lists)
    const { fresh, gone } = newsOf(calling, now)
    calling = now
    const spaces = new Set(Object.keys(lists))
    const news = fresh.filter((call) => known.has(call.space))
    known = spaces
    withdraw(gone.map((call) => call.key))
    seen()
    if (news.length === 0) return
    gathered.push(...news)
    timer ??= setTimeout(() => void tellNews(), GATHER)
  }

  heard(window.lists())
  const stops = [
    window.watchLists(() => heard(window.lists())),
    window.watchSight(seen),
    // A click on a notice brings the window to the front and goes there;
    // the notice of many shows the sidebar, which lists them all.
    desktop?.listen((key) => {
      if (key === SUMMARY) return window.run("sidebar.show")
      const button = toldThere.get(key)
      if (button) return void press(clicked(button)!)
      const call = calling.find((each) => each.key === key)
      if (call) answer(call)
    }) ?? (() => undefined),
  ]
  return {
    told,
    stop: () => {
      clearTimeout(timer)
      for (const stop of stops) stop()
    },
  }
}
