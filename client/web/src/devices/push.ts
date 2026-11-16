/**
 * Pushes to this device (ADR 0124, decision 10; ADR 0081, decision 6;
 * SE7): a browser that takes them says to each machine it reaches where a
 * push finds it while its page is not open, and the machine pushes there
 * itself, with no Banda Cloud between.
 *
 * A browser has one subscription, made under one key, and the machines
 * are peers: so the key is this device's own, made here and kept beside
 * its other one, and the device hands the same subscription, with the
 * key that signs a push to it, to every machine. Each is the Person's,
 * and reached as this device, by its key.
 *
 * Banda's app takes none: its window is told as ever. An iPhone gives a
 * page pushes only once it is on the Home Screen (`home`).
 */
import { base64url, bytesOf, type Engine } from "@banda/contract"
import type { Subscription } from "@banda/contract/devices"
import { Store } from "@banda/core"
import { useStore } from "@banda/core/react"
import { device } from "../boot"
import { inBrowser, type Kept } from "../boot/browser"

/**
 * How pushes stand on this device: it has `none` to take; it takes them
 * once the page is opened from the Home Screen (`home`); the Person may
 * be asked (`ask`), has said no to the browser (`denied`), or takes them
 * (`on`).
 */
export type Stand = "none" | "home" | "ask" | "denied" | "on"

/** What of the browser pushes are read from: its own in a page, a fake
 * in a test. */
export type Browser = {
  /** Banda's app, not a browser. */
  app: boolean
  /** The browser has pushes for this page. */
  pushes: boolean
  /** An iPhone's or iPad's browser, and whether the page was opened
   * from the Home Screen; none elsewhere. */
  standalone: boolean | undefined
  permission: () => NotificationPermission
  /** The page's worker, where it has one. */
  worker: () => Promise<ServiceWorkerRegistration | undefined>
}

const ours = (): Browser => ({
  app: device.has("webview"),
  pushes:
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window,
  standalone: (navigator as { standalone?: boolean }).standalone,
  permission: () => Notification.permission,
  worker: () => navigator.serviceWorker.getRegistration(),
})

/** How pushes stand in `browser` now. The Person turned them on where
 * the page has its worker and the browser's leave. */
export async function standing(browser: Browser = ours()): Promise<Stand> {
  if (browser.app) return "none"
  if (!browser.pushes) return browser.standalone === false ? "home" : "none"
  const permission = browser.permission()
  if (permission === "denied") return "denied"
  if (permission === "default") return "ask"
  return (await browser.worker()) ? "on" : "ask"
}

/** The worker's file, beside the page. */
const WORKER = "./sw.js"

/** This device's push key in what it keeps. */
const PUSH_KEY = "push"

/** A push key: its public half as a browser names it, and the private
 * one that signs, each as base64url. */
type PushKey = Pick<Subscription, "key" | "signs">

/** This device's push key, made on first use and kept for good. */
export async function pushKey(kept: Kept): Promise<PushKey> {
  const have = await kept.get<PushKey>(PUSH_KEY)
  if (have) return have
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  )
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey)
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey)
  const made = { key: base64url(new Uint8Array(raw)), signs: d! }
  await kept.set(PUSH_KEY, made)
  return made
}

/** Where a push finds this device, as its browser has it under `key`;
 * one made under another key gives way to a new one. */
async function subscribed(
  worker: ServiceWorkerRegistration,
  key: PushKey
): Promise<Subscription> {
  const had = await worker.pushManager.getSubscription()
  const under = had?.options.applicationServerKey
  const same = under && base64url(new Uint8Array(under)) === key.key
  if (had && !same) await had.unsubscribe()
  const now =
    had && same
      ? had
      : await worker.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytesOf(key.key),
        })
  const { endpoint, keys } = now.toJSON()
  if (!endpoint || !keys?.p256dh || !keys.auth)
    throw new Error("This browser gave no address for pushes.")
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth, ...key }
}

/** Says to each of `engines` where a push finds this device, or with no
 * subscription that it takes none. One that does not answer is told as
 * the page next reaches it. */
const tell = (engines: readonly Engine[], subscription?: Subscription) =>
  Promise.allSettled(
    engines.map((engine) =>
      engine.command("devices.push_to", subscription ? { subscription } : {})
    )
  )

const same = (stand: Stand) => stand

/** How pushes stand on this device: the browser's, one for the page
 * whatever draws it, as its Quiet is (`calls/quiet.ts`). Read from the
 * browser as the first part asks. */
class Standing {
  readonly held = new Store<Stand>("none")
  #asked = false

  read(): void {
    if (this.#asked) return
    this.#asked = true
    void standing().then(this.now, () => {})
  }

  readonly now = (next: Stand): Stand => {
    this.held.set(next)
    return next
  }
}

const stood = new Standing()
const now = stood.now

/** How pushes stand on this device, as it changes. */
export function useStand(): Stand {
  stood.read()
  return useStore(stood.held, same)
}

/** The machines told where a push finds this device, since the page
 * started or pushes were last turned: each is told once. */
let told = new WeakSet<Engine>()

/**
 * Turns pushes on, from the Person's tap: the browser asks them, then
 * each of `engines` is told where a push finds this device. Says how
 * pushes stand after.
 */
export async function turnOn(engines: readonly Engine[]): Promise<Stand> {
  // First, while the tap still counts: Safari asks only then.
  const asked = Notification.requestPermission()
  if ((await asked) !== "granted") return now(await standing())
  told = new WeakSet()
  await kept(engines)
  return now("on")
}

/**
 * Tells each of `engines` where a push finds this device, which has them
 * on: as the page starts, and as it reaches another machine, each told
 * once. The worker is asked for again, so an updated page's takes its
 * place, and a subscription the browser let go is made again.
 */
export async function kept(engines: readonly Engine[]): Promise<void> {
  const fresh = engines.filter((engine) => !told.has(engine))
  if (fresh.length === 0) return
  await navigator.serviceWorker.register(WORKER)
  const worker = await navigator.serviceWorker.ready
  const subscription = await subscribed(worker, await pushKey(inBrowser()))
  const heard = await tell(fresh, subscription)
  heard.forEach((one, i) => one.status === "fulfilled" && told.add(fresh[i]!))
}

/** Turns pushes off: each of `engines` pushes here no more, and the
 * browser lets the subscription and the worker go. */
export async function turnOff(engines: readonly Engine[]): Promise<void> {
  told = new WeakSet()
  await tell(engines)
  const worker = await navigator.serviceWorker.getRegistration()
  await (await worker?.pushManager.getSubscription())?.unsubscribe()
  await worker?.unregister()
  now(await standing())
}

/** Whether the Person put the card that asks aside on this device. */
const LATER = "banda.push.later"

export const later = {
  is: (): boolean => {
    try {
      return localStorage.getItem(LATER) !== null
    } catch {
      return false
    }
  },
  say: (): void => {
    try {
      localStorage.setItem(LATER, "1")
    } catch {
      // A browser that keeps nothing asks again next time.
    }
  },
}
