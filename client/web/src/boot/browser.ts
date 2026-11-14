/**
 * The device a browser is, at the door of the machine that served it this
 * page (ADR 0124, decisions 3 and 6; SE5): its key, which WebCrypto makes
 * and does not hand out, and the machine it paired with, both kept in the
 * browser's own IndexedDB, as a browser has no folder of Banda's. With
 * them it comes in at the door as any device does (`engine`); without the
 * pairing it asks to be paired (`pair`).
 *
 * A browser reaches one machine by this file: the one whose door it
 * opened. The others come by their host keys, once that machine's
 * window allows this device on them too.
 */
import {
  type Address,
  askAtDoor,
  type Asker,
  type Asking,
  base64url,
} from "@banda/contract"

/** What this device keeps of itself: a few values by name. A browser's
 * is IndexedDB, which alone keeps a key WebCrypto does not hand out. */
export type Kept = {
  get: <T>(name: string) => Promise<T | undefined>
  set: (name: string, value: unknown) => Promise<void>
  remove: (name: string) => Promise<void>
}

/** The machine this device paired with: the device it is there, and the
 * host key that machine proves at its door. */
export type Paired = { device: string; hostKey: string }

/** What a device asks under: the name the Person reads it by on the
 * machine, and its kind. */
export type Self = Pick<Asker, "name" | "kind">

/** Asks a door to pair this device, telling `heard` how the asking
 * stands; returns how to stop asking. */
export type Pairs = (as: Self, heard: (asking: Asking) => void) => () => void

const DATABASE = "banda"
const STORE = "device"
const KEY = "key"
const DOOR = "door"

/** One request of IndexedDB's, as a promise. */
const settled = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((done, failed) => {
    request.onsuccess = () => done(request.result)
    request.onerror = () => failed(request.error)
  })

/** The browser's own keeping, in IndexedDB. */
export function inBrowser(): Kept {
  let opened: Promise<IDBDatabase> | undefined
  const store = async (mode: IDBTransactionMode) => {
    opened ??= (() => {
      const opening = indexedDB.open(DATABASE, 1)
      opening.onupgradeneeded = () => opening.result.createObjectStore(STORE)
      return settled(opening)
    })()
    return (await opened).transaction(STORE, mode).objectStore(STORE)
  }
  return {
    get: async (name) => settled((await store("readonly")).get(name)),
    set: async (name, value) => {
      await settled((await store("readwrite")).put(value, name))
    },
    remove: async (name) => {
      await settled((await store("readwrite")).delete(name))
    },
  }
}

/** Where the door that served this page listens. */
export const doorOf = ({ protocol, host }: Location): string =>
  `${protocol === "https:" ? "wss" : "ws"}://${host}/ws`

/**
 * What this browser suggests the Person reads it by on the machine,
 * "Safari on macOS", and whether it is a phone: all a browser knows of
 * itself. The Person may write another name before it asks.
 */
export function selfOf(agent: string): Self {
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\/|FxiOS\//.test(agent)
      ? "Firefox"
      : /Chrome\/|CriOS\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "A browser"
  const system = /iPhone/.test(agent)
    ? "iPhone"
    : /iPad/.test(agent)
      ? "iPad"
      : /Android/.test(agent)
        ? "Android"
        : /Mac OS X/.test(agent)
          ? "macOS"
          : /Windows/.test(agent)
            ? "Windows"
            : /Linux/.test(agent)
              ? "Linux"
              : undefined
  const phone = /iPhone|Android.*Mobile/.test(agent)
  return {
    name: system ? `${browser} on ${system}` : browser,
    kind: phone ? "phone" : "browser",
  }
}

/** The name the machine at this page's door gives itself, as its one
 * line says it to anyone who reaches it; none where nothing answers so. */
export async function machineAtDoor(
  get: typeof fetch = fetch
): Promise<string | undefined> {
  try {
    const answer = await get("/", { headers: { accept: "text/plain" } })
    if (!answer.ok) return undefined
    return /^Banda on (.+) · \S+\s*$/.exec(await answer.text())?.[1]
  } catch {
    return undefined
  }
}

/** This device in a browser, over what it keeps in `kept`. */
export function browserDevice(kept: Kept, door: () => string) {
  /** This device's key, made on the first ask and kept for good: the
   * browser signs with it and never hands it out. Read once: it never
   * changes, and two who ask at once make one key. */
  let mine: Promise<CryptoKeyPair> | undefined
  const key = () =>
    (mine ??= (async () => {
      const have = await kept.get<CryptoKeyPair>(KEY)
      if (have) return have
      const made = (await crypto.subtle.generateKey("Ed25519", false, [
        "sign",
        "verify",
      ])) as CryptoKeyPair
      await kept.set(KEY, made)
      return made
    })())
  const sign = async (message: string): Promise<string> => {
    const { privateKey } = await key()
    const said = new TextEncoder().encode(message)
    return base64url(
      new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, said))
    )
  }
  /** The pairing, read once and kept beside what is written. */
  let at: Promise<Paired | undefined> | undefined
  const paired = () => (at ??= kept.get<Paired>(DOOR))
  const pair: Pairs = ({ name, kind }, heard) => {
    let stop: (() => void) | undefined
    let stopped = false
    void (async () => {
      const { publicKey } = await key()
      const raw = await crypto.subtle.exportKey("raw", publicKey)
      if (stopped) return
      const asker = { key: base64url(new Uint8Array(raw)), sign, name, kind }
      stop = askAtDoor(door(), asker, (asking) => {
        if (asking.state !== "paired") return heard(asking)
        const now: Paired = { device: asking.device, hostKey: asking.hostKey }
        void kept.set(DOOR, now).then(
          () => {
            at = Promise.resolve(now)
            heard(asking)
          },
          () => heard({ state: "lost" })
        )
      })
    })().catch(() => stopped || heard({ state: "lost" }))
    return () => {
      stopped = true
      stop?.()
    }
  }
  return {
    /** The machine this device paired with, if it has. */
    paired,
    /**
     * Where this machine's engine listens, as the page connects to it:
     * the door that served the page, as the device it paired as. Refused
     * until it has paired.
     */
    engine: async (): Promise<Address> => {
      const at = await paired()
      if (!at) throw new Error("This browser has not paired with this machine.")
      return { url: door(), door: { ...at, sign } }
    },
    /**
     * Asks the door to pair this device, and tells how the asking
     * stands; once the Person allowed it, the pairing is kept before
     * `heard` hears so.
     */
    pair,
    /** Forgets the pairing, as the machine said this device is its no
     * more: it asks again. The key stays this device's. */
    forget: () => {
      at = Promise.resolve(undefined)
      return kept.remove(DOOR)
    },
  }
}

/** This browser, at the door that served its page. */
export const browser = browserDevice(inBrowser(), () => doorOf(location))
