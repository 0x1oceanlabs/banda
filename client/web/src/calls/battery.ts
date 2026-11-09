/**
 * Another machine's battery runs low while its Agents work there: one
 * toast, once per discharge (ADR 0097, decision 8). The window works it
 * out, keyed by the machine, from what the machine says on
 * `machine.power` (`Shown.power`) and from its lists, as `tellWoke` does
 * a Thread's waking. A toast only: no sound, and no notice of the
 * desktop's (Roma's call). It moves to the host with the calls later (ADR
 * 0081, decision 6).
 */
import { createElement, useCallback, useContext, useEffect } from "react"
import { toast } from "@banda/ui/components/sonner"
import { works } from "@banda/ui/components/banda-mark"
import type { Lists } from "@banda/ui/pane"
import {
  agentsWork,
  onBattery,
  type Readable,
  type Shown,
  useStore,
} from "@banda/core/react"
import { BatteryWarningIcon } from "lucide-react"
import { type Stores, StoresContext } from "./stores"

/** The charge, in percent, at or under which a machine on battery is
 * low. */
export const LOW = 20

/** How many Agents' Turns run in `lists`: those at work, and those that
 * wait on the Person's Question, as their machine stays awake for both
 * (ADR 0097, decision 1). */
export function turnsIn(lists: Lists): number {
  return Object.values(lists)
    .flat()
    .filter((listed) => works(listed.mark) || listed.mark === "asking").length
}

/** How many Agents' Turns run on host `host`, as its Watches list them
 * in `stores`. */
export const turnsOn = (stores: Stores, host: string): number =>
  turnsIn(stores.hosts.get(host)?.lists ?? {})

/** `turnsOn`, drawn again as it changes: the "2 Agents work there" of
 * Settings and of the machine's hover. */
export function useTurnsOn(host: string): number {
  const stores = useContext(StoresContext)
  const select = useCallback(() => turnsOn(stores, host), [stores, host])
  return useStore(stores.items, select)
}

/** A machine low on battery while its Agents work there. */
export type Low = {
  /** Its key in `hosts.toml`. */
  host: string
  /** Its name, as it says it. */
  name: string
  percent: number
  /** How many of its Agents' Turns run. */
  working: number
}

/** What the warning says: "m1pro: 12%, on battery", "2 Agents work
 * there. Plug it in, or it sleeps as the battery runs out." */
export function lowWords({ name, percent, working }: Low): {
  title: string
  body: string
} {
  return {
    title: `${name}: ${percent}%, on battery`,
    body: `${agentsWork(working)} there. Plug it in, or it sleeps as the battery runs out.`,
  }
}

/**
 * Which machines to warn of now, from `hosts` as the window shows them
 * and how many Turns run on each (`turns`), after those `warned` already
 * this discharge: each on battery at `LOW` or under, with a Turn running,
 * not warned yet. One on power again may be warned again, and its warning
 * goes (`plugged`); one that says no battery now, as while it is away,
 * stays as it was, so it is not warned again before it was on power.
 */
export function lowNow(
  warned: ReadonlySet<string>,
  hosts: readonly Shown[],
  turns: (host: string) => number
): { warned: Set<string>; tell: Low[]; plugged: string[] } {
  const now = new Set<string>()
  const tell: Low[] = []
  const plugged: string[] = []
  for (const { name: host, named, power } of hosts) {
    const battery = power?.battery
    if (!battery) {
      if (warned.has(host)) now.add(host)
      continue
    }
    if (!onBattery(battery)) {
      if (warned.has(host)) plugged.push(host)
      continue
    }
    if (warned.has(host)) {
      now.add(host)
      continue
    }
    const working = battery.percent <= LOW ? turns(host) : 0
    if (working === 0) continue
    now.add(host)
    tell.push({ host, name: named.name, percent: battery.percent, working })
  }
  // One taken out of hosts.toml: its warning goes with it.
  for (const host of warned)
    if (!hosts.some((one) => one.name === host)) plugged.push(host)
  return { warned: now, tell, plugged }
}

/** Where the warning shows, and how it goes. */
export type Toasts = {
  show: (key: string, low: Low) => void
  hide: (key: string) => void
}

/** The warning's toast: Sonner's, a warning's edge, until the Person
 * closes it or the machine is on power. */
const SONNER: Toasts = {
  show: (key, low) => {
    const { title, body } = lowWords(low)
    toast.warning(title, {
      id: key,
      testId: key,
      description: body,
      icon: createElement(BatteryWarningIcon, {
        "aria-hidden": true,
        className: "size-4 text-attention",
      }),
      duration: Infinity,
      closeButton: true,
    })
  },
  hide: (key) => void toast.dismiss(key),
}

/** The warning's key, by the machine. */
export const lowKey = (host: string) => `battery:${host}`

/** Warns, by `toasts`, of each machine of `hosts` low on battery while
 * its Agents work there (`lowNow`), as `stores` list them; returns how
 * to stop. */
export function tellLow(
  hosts: Readable<readonly Shown[]>,
  stores: Stores,
  toasts: Toasts = SONNER
): () => void {
  let warned: ReadonlySet<string> = new Set()
  const look = () => {
    const now = lowNow(warned, hosts.get(), (host) => turnsOn(stores, host))
    warned = now.warned
    for (const host of now.plugged) toasts.hide(lowKey(host))
    for (const low of now.tell) toasts.show(lowKey(low.host), low)
  }
  look()
  const stopHosts = hosts.subscribe(look)
  const stopItems = stores.items.subscribe(look)
  return () => {
    stopHosts()
    stopItems()
  }
}

/** `tellLow` for as long as the Window draws the other machines'
 * Watches (`bar/Watches.tsx`), which fill `stores` with their lists. */
export function useLowBattery(
  hosts: Readable<readonly Shown[]>,
  stores: Stores
): void {
  useEffect(() => tellLow(hosts, stores), [hosts, stores])
}
