import { useCallback, useEffect, useRef, useState } from "react"
import type { SpaceId } from "@bandaso/contract"
import { MARK_ORDER } from "@bandaso/ui/components/banda-mark"
import type { Listed } from "@bandaso/ui/pane"
import { type Chime, player, type SoundSettings } from "@bandaso/ui/sound"
import type { Host } from "../host"
import { GATHER, loudestChime, type Played, plays } from "./calls"
import type { NotifySettings } from "./settings"
import { iconOf, loudestOf, MANY, noticeOf, SUMMARY, summaryOf } from "./system"
import { type Call, callsOf, newsOf, type Sight, tell } from "./tell"
import { alive, released, type Toast, told } from "./toasts"

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
  /** The toasts, the newest first. */
  toasts: readonly Toast[]
  /** The pointer holds the toasts, or lets them go. */
  hold: (holds: boolean) => void
  /** Takes a toast away, as when it was answered. */
  dismiss: (key: string) => void
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
  notify: NotifySettings,
  where: Where
): Calls {
  const settings = useRef({ sound, notify, where })
  useEffect(() => {
    settings.current = { sound, notify, where }
  }, [sound, notify, where])

  const lists = useRef(new Map<string, Heard[]>())
  const [calling, setCalling] = useState<readonly Heard[]>([])
  const [toasts, setToasts] = useState<readonly Toast[]>([])
  const gathered = useRef<Heard[]>([])
  const last = useRef<Played | undefined>(undefined)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])

  // The notices the desktop shows: one per thing, and one for many.
  const noticed = useRef(new Set<string>())
  const summarized = useRef(new Set<string>())
  const withdraw = useCallback((keys: Iterable<string>) => {
    const desktop = settings.current.where.desktop
    const had = summarized.current.size
    for (const key of keys) {
      if (noticed.current.delete(key)) desktop?.withdraw(key)
      summarized.current.delete(key)
    }
    if (had > 0 && summarized.current.size === 0) desktop?.withdraw(SUMMARY)
  }, [])

  const tellNews = useCallback(async () => {
    timer.current = 0
    const news = new Map(gathered.current.map((call) => [call.key, call]))
    gathered.current = []
    const { sound, notify, where } = settings.current
    const { desktop } = where
    const quiet = desktop ? await desktop.quiet().catch(() => false) : false
    const chimes: Chime[] = []
    const notices: Heard[] = []
    const now = Date.now()
    let next: Toast[] | undefined
    for (const call of news.values()) {
      const telling = tell(call.chime, where.sight(call), notify, quiet)
      if (telling.sound) chimes.push(call.chime)
      if (telling.toast) next = told(next ?? [], call.key, call.chime, now)
      if (telling.system) notices.push(call)
    }
    if (next) {
      const added = next
      setToasts((toasts) =>
        added.reduceRight(
          (all, toast) => told(all, toast.key, toast.chime, now),
          toasts as Toast[]
        )
      )
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
      const keys = new Set(gone.map((call) => call.key))
      setToasts((toasts) => toasts.filter((toast) => !keys.has(toast.key)))
      withdraw(keys)
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

  // The toasts go away by themselves, unless the pointer holds them.
  const heldAt = useRef<number | undefined>(undefined)
  const hold = useCallback((holds: boolean) => {
    if (holds) {
      heldAt.current ??= Date.now()
      return
    }
    const from = heldAt.current
    heldAt.current = undefined
    if (from === undefined) return
    const now = Date.now()
    setToasts((toasts) => released(toasts, now - from, now))
  }, [])
  useEffect(() => {
    if (toasts.length === 0) return
    const tick = window.setInterval(() => {
      if (heldAt.current !== undefined) return
      setToasts((toasts) => {
        const left = alive(toasts, Date.now())
        return left.length === toasts.length ? toasts : left
      })
    }, 250)
    return () => clearInterval(tick)
  }, [toasts.length])

  const dismiss = useCallback(
    (key: string) =>
      setToasts((toasts) =>
        toasts.some((toast) => toast.key === key)
          ? toasts.filter((toast) => toast.key !== key)
          : toasts
      ),
    []
  )
  const seen = useCallback(
    (key: string) => {
      dismiss(key)
      withdraw([key])
    },
    [dismiss, withdraw]
  )

  return { hear, leave, calling, toasts, hold, dismiss, seen }
}

/**
 * The call to answer first: the loudest, then the one that called first,
 * as Hyprland's `focusurgentorlast` goes (ADR 0011, decision 5).
 */
export function first(calling: readonly Heard[]): Heard | undefined {
  return [...calling].sort(
    (a, b) => MARK_ORDER[b.chime] - MARK_ORDER[a.chime] || a.since - b.since
  )[0]
}
