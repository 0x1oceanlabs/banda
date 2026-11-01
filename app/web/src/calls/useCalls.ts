import { useCallback, useEffect, useRef, useState } from "react"
import type { SpaceId } from "@bandaso/contract"
import { MARK_ORDER } from "@bandaso/ui/components/banda-mark"
import type { Listed } from "@bandaso/ui/pane"
import { type Chime, player, type SoundSettings } from "@bandaso/ui/sound"
import { GATHER, loudestChime, type Played, plays } from "./calls"
import type { NotifySettings } from "./settings"
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
  /** Whether the desktop is quiet now (ADR 0011, decision 4). */
  quiet: () => boolean
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
}

/**
 * What the window does with what calls in the modules' lists (ADR 0011):
 * it finds what is news, gathers it for a moment, plays the loudest sound
 * (ADR 0009) and tells of each call where the Person will notice it. A
 * call that stops takes its toast with it. The functions it gives stay the
 * same, so a Watch can keep them.
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

  const tellNews = useCallback(() => {
    timer.current = 0
    const news = new Map(gathered.current.map((call) => [call.key, call]))
    gathered.current = []
    const { sound, notify, where } = settings.current
    const quiet = where.quiet()
    const chimes: Chime[] = []
    const now = Date.now()
    let next: Toast[] | undefined
    for (const call of news.values()) {
      const telling = tell(call.chime, where.sight(call), notify, quiet)
      if (telling.sound) chimes.push(call.chime)
      if (telling.toast) next = told(next ?? [], call.key, call.chime, now)
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
    if (!chime || !plays(last.current, chime, at)) return
    last.current = { chime, at }
    player.play(chime, sound)
  }, [])

  const changed = useCallback((gone: readonly Heard[]) => {
    setCalling([...lists.current.values()].flat())
    if (gone.length === 0) return
    const keys = new Set(gone.map((call) => call.key))
    setToasts((toasts) => toasts.filter((toast) => !keys.has(toast.key)))
  }, [])

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
      if (!timer.current) timer.current = window.setTimeout(tellNews, GATHER)
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
      setToasts((toasts) => toasts.filter((toast) => toast.key !== key)),
    []
  )

  return { hear, leave, calling, toasts, hold, dismiss }
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
