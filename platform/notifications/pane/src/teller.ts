/**
 * What the notifications module does with what calls in the lists (ADR
 * 0011, ADR 0056, decision 1): it finds what is news, gathers it for a
 * moment, plays the loudest sound (ADR 0009) and tells of each call where
 * the Person will notice it: a toast, or a system notification. A call
 * that stops, or that the Person looks at, takes them back.
 */
import type { ProjectId } from "@banda/contract"
import { toast } from "@banda/ui/components/sonner"
import type { Thing, WindowApi } from "@banda/ui/module"
import { type Call, callsOf, type Lists, type PaneState } from "@banda/ui/pane"
import { type Chime, player } from "@banda/ui/sound"
import { type Desktop, desktopOf } from "./desktop"
import { keep } from "./recent"
import { GATHER, loudestChime, type Played, plays } from "./sound"
import {
  iconOf,
  loudestOf,
  MANY,
  noticeOf,
  quietNow,
  soundsOf,
  SUMMARY,
  JOINED,
  joinedOf,
  summaryOf,
  toldOfCall,
} from "./system"
import { lookedAt, newsOf, placeOf, silentWith, tell } from "./tell"
import { clickToasts, toastTold } from "./toast"
import { type Button, clicked, type Told } from "./told"

/** What tells: what calls, from the lists, and what a module tells. */
export type Teller = {
  /** Tells what a module told, where the Person will notice it. */
  told: (told: Told) => Promise<void>
  /** Goes to a thing that calls, as its toast's button does, by the
   * Window's `pane.pick` (ADR 0087, decision 7): its toast and its
   * notification go. */
  answer: (thing: Thing & { pane: PaneState }) => void
  stop: () => void
}

/** Starts telling. */
export function startTelling(
  window: WindowApi,
  desktop: Desktop | undefined = desktopOf()
): Teller {
  let calling: readonly Call[] = []
  // The Projects already listed: a Project's first list is what already was.
  let known = new Set<string>()
  let gathered: Call[] = []
  let last: Played | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  // The toasts up, and the notices the desktop shows: one per thing, and
  // one for many.
  const toasted = new Set<string>()
  const noticed = new Set<string>()
  const summarized = new Set<string>()
  // Whether the desktop's notices make its own sound, as Windows' do,
  // which no run of the window changes.
  const desktopSounds = soundsOf(desktop)

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
  const told = async (said: Told) => {
    const { notify } = window.look()
    const of = said.in as ProjectId | undefined
    const thing =
      of && said.about ? { project: of, about: said.about } : undefined
    const sight = window.sight(thing)
    // What it tells of is in sight: it says it there itself.
    if (sight === "on-screen") return
    const place = placeOf(sight, notify, await quietNow(notify, desktop))
    if (!place) return
    const named = of && !said.project ? projectNameOf(of) : undefined
    const told = named ? { ...said, project: named } : said
    // A notice of the desktop's that sounds by itself carries the sound.
    const noticeSounds = place.system && (await desktopSounds)
    if (!told.silent && !noticeSounds) sounds(told.kind)
    // Kept, wherever it is told, so the bell shows it again (ADR 0056,
    // decision 2).
    keep(told)
    if (place.toast) toastTold(told, press)
    if (!place.system || !desktop) return
    toldThere.set(told.key, told)
    desktop.show({
      key: told.key,
      title: told.title,
      ...((told.notice ?? told.body) ? { body: told.notice ?? told.body } : {}),
      answer: clicked(told)?.label ?? "Open",
      lasts: told.kind === "asking",
      silent: silentWith(window.look().sound, told.kind, told.silent),
    })
  }
  // The Project a thing is of, by name, when the window has more than one.
  const projectNameOf = (project: ProjectId) => {
    const projects = window.projects()
    if (projects.length < 2) return undefined
    return projects.find((each) => each.id === project)?.name || undefined
  }
  // The `done` calls the joined toast shows, while it does.
  let joined: Call[] = []
  // Toasts a `done` call: joined with those that show, if any do.
  const toastDone = (call: Call, told: Told, detail: boolean) => {
    const up = new Set(toast.getToasts().map((one) => String(one.id)))
    const showing = [
      ...(up.has(JOINED) ? joined : []),
      ...[...toasted].flatMap((key) => {
        const was = calling.find((one) => one.key === key)
        return was?.chime === "done" && up.has(key) ? [was] : []
      }),
    ].filter((one) => one.key !== call.key)
    if (showing.length === 0) return void toastTold(told, press)
    for (const one of showing) if (up.has(one.key)) toast.dismiss(one.key)
    joined = [
      ...new Map([...showing, call].map((one) => [one.key, one])).values(),
    ]
    toastTold(joinedOf(joined, detail), press)
  }
  const answer = (thing: Thing & { pane: PaneState }) => {
    window.run("pane.pick", { project: thing.project, pane: thing.pane })
    withdraw([`${thing.project}:${thing.about}`])
  }

  const tellNews = async () => {
    timer = undefined
    const news = new Map(gathered.map((call) => [call.key, call]))
    gathered = []
    const { notify, sound } = window.look()
    const quiet = await quietNow(notify, desktop)
    const own = await desktopSounds
    const chimes: Chime[] = []
    const notices: Call[] = []
    for (const call of news.values()) {
      const telling = tell(call.chime, window.sight(call), notify, quiet, own)
      if (telling.sound) chimes.push(call.chime)
      const told = toldOfCall(call, notify.detail, projectNameOf(call.project))
      if (telling.toast || telling.system) keep(told)
      if (telling.toast) {
        toasted.add(call.key)
        if (call.chime === "done") toastDone(call, told, notify.detail)
        else toastTold(told, press)
      }
      if (telling.system) notices.push(call)
    }
    const chime = loudestChime(chimes)
    if (chime) sounds(chime)
    if (!desktop || notices.length === 0) return
    if (notices.length > MANY) {
      for (const call of notices) summarized.add(call.key)
      const icon = await iconOf(loudestOf(notices))
      desktop.show({
        ...summaryOf(notices),
        silent: notices.every((call) => silentWith(sound, call.chime)),
        ...(icon ? { icon } : {}),
      })
      return
    }
    for (const call of notices) {
      noticed.add(call.key)
      const icon = await iconOf(call.chime)
      desktop.show({
        ...noticeOf(call, notify.detail, projectNameOf(call.project)),
        silent: silentWith(sound, call.chime),
        ...(icon ? { icon } : {}),
      })
    }
  }

  // What the Person looks at is seen: its toast and notification go,
  // while the call may still wait for them, as a Question does.
  const seen = () =>
    withdraw(lookedAt(calling, window.here.get()).map((call) => call.key))

  const heard = (lists: Lists) => {
    const now = callsOf(lists)
    const { fresh, gone } = newsOf(calling, now)
    calling = now
    const projects = new Set(Object.keys(lists))
    const news = fresh.filter((call) => known.has(call.project))
    known = projects
    withdraw(gone.map((call) => call.key))
    seen()
    if (news.length === 0) return
    gathered.push(...news)
    timer ??= setTimeout(() => void tellNews(), GATHER)
  }

  heard(window.items.get())
  const stops = [
    clickToasts(),
    window.items.subscribe(() => heard(window.items.get())),
    // Where the Person is changes what they look at.
    window.here.subscribe(seen),
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
    answer,
    stop: () => {
      clearTimeout(timer)
      for (const stop of stops) stop()
    },
  }
}
