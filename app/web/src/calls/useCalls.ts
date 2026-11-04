import { useCallback, useEffect, useRef, useState } from "react"
import type { SpaceId } from "@banda/contract"
import { callOrder } from "@banda/ui/components/banda-mark"
import { toast, toastUnseen } from "@banda/ui/components/sonner"
import type { Listed } from "@banda/ui/pane"
import { type Chime, player, type SoundSettings } from "@banda/ui/sound"
import type { Notify } from "@banda/contract/look"
import type { Host } from "../host"
import { toastCall } from "./callToast"
import { GATHER, loudestChime, type Played, plays } from "./calls"
import {
  iconOf,
  loudestOf,
  MANY,
  noticeOf,
  quietNow,
  SUMMARY,
  summaryOf,
} from "./system"
import { type Call, callsOf, newsOf, type Sight, tell } from "./tell"

/** A call as the window heard it: of a Space, since a time, by a key. */
export type Heard = Call & {
  key: string
  space: SpaceId
  /** When it started calling this way, in ms. */
  since: number
}

/** What the window knows of where the Person looks. */
export type Where = {
  /** Where they look, for this call. */
  sight: (call: Heard) => Sight
  /**
   * The desktop: its notifications, and whether it is quiet (ADR 0011,
   * decisions 3 and 4). None outside it.
   */
  desktop?: Host["notify"]
}

export type Calls = {
  /** What one Watch lists now; `source` names the Watch. */
  hear: (source: string, space: SpaceId, listed: readonly Listed[]) => void
  /** The Watch is gone, and what it said with it. */
  leave: (source: string) => void
  /** Everything that calls now, from every Watch. */
  calling: readonly Heard[]
  /**
   * The Person sees what calls: its toast and its notification go, while
   * the call may still wait for them, as a Question does.
   */
  seen: (key: string) => void
}

/**
 * What the window does with what calls in the modules' lists (ADR 0011):
 * it finds what is news, gathers it for a moment, plays the loudest sound
 * (ADR 0009) and tells of each call where the Person will notice it: a
 * toast, or a system notification. A call that stops, or that the Person
 * sees, takes them back. The functions it gives stay the same, so a Watch
 * can keep them.
 */
export function useCalls(
  sound: SoundSettings,
  notify: Notify,
  where: Where,
  /** What a toast's button does: goes to its call. */
  answer: (call: Heard) => void
): Calls {
  const settings = useRef({ sound, notify, where, answer })
  useEffect(() => {
    settings.current = { sound, notify, where, answer }
  }, [sound, notify, where, answer])

  const lists = useRef(new Map<string, Heard[]>())
  const [calling, setCalling] = useState<readonly Heard[]>([])
  const gathered = useRef<Heard[]>([])
  const last = useRef<Played | undefined>(undefined)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])

  // The toasts up, and the notices the desktop shows: one per thing, and
  // one for many.
  const toasted = useRef(new Set<string>())
  const noticed = useRef(new Set<string>())
  const summarized = useRef(new Set<string>())
  const withdraw = useCallback((keys: Iterable<string>) => {
    const desktop = settings.current.where.desktop
    const had = summarized.current.size
    for (const key of keys) {
      if (toasted.current.delete(key)) toast.dismiss(key)
      if (noticed.current.delete(key)) desktop?.withdraw(key)
      summarized.current.delete(key)
    }
    if (had > 0 && summarized.current.size === 0) desktop?.withdraw(SUMMARY)
  }, [])

  const tellNews = useCallback(async () => {
    timer.current = 0
    const news = new Map(gathered.current.map((call) => [call.key, call]))
    gathered.current = []
    const { sound, notify, where, answer } = settings.current
    const { desktop } = where
    const quiet = await quietNow(notify, desktop)
    const chimes: Chime[] = []
    const notices: Heard[] = []
    for (const call of news.values()) {
      const telling = tell(call.chime, where.sight(call), notify, quiet)
      if (telling.sound) chimes.push(call.chime)
      if (telling.toast) {
        toasted.current.add(call.key)
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
    const at = performance.now()
    if (chime && plays(last.current, chime, at)) {
      last.current = { chime, at }
      player.play(chime, sound)
    }
    if (!desktop || notices.length === 0) return
    if (notices.length > MANY) {
      for (const call of notices) summarized.current.add(call.key)
      const icon = await iconOf(loudestOf(notices))
      desktop.show({ ...summaryOf(notices), ...(icon ? { icon } : {}) })
      return
    }
    for (const call of notices) {
      noticed.current.add(call.key)
      const icon = await iconOf(call.chime)
      desktop.show({
        ...noticeOf(call, notify.detail),
        ...(icon ? { icon } : {}),
      })
    }
  }, [])

  const changed = useCallback(
    (gone: readonly Heard[]) => {
      setCalling([...lists.current.values()].flat())
      if (gone.length === 0) return
      withdraw(gone.map((call) => call.key))
    },
    [withdraw]
  )

  const hear = useCallback(
    (source: string, space: SpaceId, listed: readonly Listed[]) => {
      const before = lists.current.get(source)
      const now = callsOf(listed).map((call): Heard => {
        const was = before?.find((b) => b.about === call.about)
        return {
          ...call,
          space,
          key: `${space}:${call.about}`,
          since: was && was.chime === call.chime ? was.since : Date.now(),
        }
      })
      lists.current.set(source, now)
      const { fresh, gone } = newsOf(before, now)
      changed(gone)
      if (fresh.length === 0) return
      gathered.current.push(...fresh)
      if (!timer.current)
        timer.current = window.setTimeout(() => void tellNews(), GATHER)
    },
    [changed, tellNews]
  )

  const leave = useCallback(
    (source: string) => {
      const gone = lists.current.get(source) ?? []
      lists.current.delete(source)
      changed(gone)
    },
    [changed]
  )

  const seen = useCallback((key: string) => withdraw([key]), [withdraw])

  return { hear, leave, calling, seen }
}

/** The call to answer first, in the order calls are answered. */
export function first(calling: readonly Heard[]): Heard | undefined {
  return [...calling].sort(
    callOrder(
      (call) => call.chime,
      (call) => call.since
    )
  )[0]
}
