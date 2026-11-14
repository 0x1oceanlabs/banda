import { type Asking, base64url, PROTOCOL } from "@banda/contract"
import {
  askMessage,
  challengeMessage,
  pairedMessage,
  signed,
} from "@banda/contract/door"
import { afterEach, expect, test, vi } from "vitest"
import {
  browserDevice,
  doorOf,
  type Kept,
  machineAtDoor,
  selfOf,
} from "./browser"

afterEach(() => vi.unstubAllGlobals())

/** What a device keeps, in memory. */
function kept(): Kept & { held: Map<string, unknown> } {
  const held = new Map<string, unknown>()
  return {
    held,
    get: async <T>(name: string) => held.get(name) as T | undefined,
    set: async (name, value) => void held.set(name, value),
    remove: async (name) => void held.delete(name),
  }
}

/** An Ed25519 key, and its public half as the door says it. */
async function keyed() {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey)
  const sign = async (message: string) =>
    base64url(
      new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          pair.privateKey,
          new TextEncoder().encode(message)
        )
      )
    )
  return { key: base64url(new Uint8Array(raw)), sign }
}

/**
 * A machine's door, as a WebSocket a page opens: it challenges, hears the
 * `ask`, says the code, and pairs the device once `allow` is called.
 */
async function door() {
  const host = await keyed()
  const nonce = "door-nonce"
  const heard: { url?: string; ask?: Record<string, string> } = {}
  /** Says a frame to the page that opened the door. */
  let say: ((frame: object) => void) | undefined
  class Fake {
    onmessage: ((message: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    constructor(url: string) {
      heard.url = url
      say = (frame) => this.says(frame)
      const protocol = { min: PROTOCOL, max: PROTOCOL }
      void host
        .sign(challengeMessage(nonce, host.key, 1, protocol))
        .then((sig) =>
          this.says({
            type: "challenge",
            nonce,
            host_key: host.key,
            time: 1,
            protocol,
            sig,
          })
        )
    }
    says(frame: object) {
      this.onmessage?.({ data: JSON.stringify(frame) })
    }
    send(text: string) {
      heard.ask = JSON.parse(text)
      this.says({ type: "asked", code: "4F7K-92QD", until: 5 })
    }
    close() {
      this.onclose?.()
    }
  }
  vi.stubGlobal("WebSocket", Fake)
  return {
    host,
    nonce,
    heard,
    allow: async (device: string) =>
      say!({
        type: "paired",
        device,
        sig: await host.sign(pairedMessage(nonce, heard.ask!.key!, device)),
      }),
  }
}

test("a browser names itself by what it knows, its browser and its system, and a phone is a phone", () => {
  const mac =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
  expect(selfOf(mac)).toEqual({ name: "Safari on macOS", kind: "browser" })
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"
  expect(selfOf(iphone)).toEqual({ name: "Safari on iPhone", kind: "phone" })
  const linux =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
  expect(selfOf(linux)).toEqual({ name: "Chrome on Linux", kind: "browser" })
  expect(selfOf("curl/8")).toEqual({ name: "A browser", kind: "browser" })
})

test("the door is the page's own address, by wss where the page came by https", () => {
  const at = (href: string) => doorOf(new URL(href) as unknown as Location)
  expect(at("https://arc.example.ts.net/")).toBe("wss://arc.example.ts.net/ws")
  expect(at("http://127.0.0.1:4711/#pane/1")).toBe("ws://127.0.0.1:4711/ws")
})

test("the machine at the door is named by its one line, and by nothing else that answers there", async () => {
  const says = (text: string, ok = true) =>
    machineAtDoor((async () => ({ ok, text: async () => text })) as never)
  expect(await says("Banda on arc · q83k_Aa-\n")).toBe("arc")
  expect(await says("Banda on Roma's Mac · key\n")).toBe("Roma's Mac")
  expect(await says("<!doctype html>")).toBeUndefined()
  expect(await says("Banda on arc · key\n", false)).toBeUndefined()
  expect(
    await machineAtDoor(() => Promise.reject(new Error("away")))
  ).toBeUndefined()
})

test("a browser asks under a key it makes once and never hands out, and comes in as the device the machine paired", async () => {
  const at = await door()
  const mine = kept()
  const device = browserDevice(mine, () => "ws://door/ws")
  // Not paired: no engine to reach.
  await expect(device.engine()).rejects.toThrow("has not paired")
  expect(await device.paired()).toBeUndefined()

  const said: Asking[] = []
  const done = new Promise<void>((done) => {
    device.pair({ name: "Safari on macOS", kind: "browser" }, (asking) => {
      said.push(asking)
      if (asking.state === "asked") void at.allow("device-7")
      if (asking.state === "paired") done()
    })
  })
  await done
  expect(at.heard.url).toBe("ws://door/ws")
  expect(said).toEqual([
    { state: "asked", code: "4F7K-92QD", until: 5, hostKey: at.host.key },
    { state: "paired", device: "device-7", hostKey: at.host.key },
  ])
  // What it asked, its own key signed: the door's nonce, that host key,
  // its origin, its key, its kind and its name.
  const { key, name, kind, sig } = at.heard.ask!
  expect({ name, kind }).toEqual({ name: "Safari on macOS", kind: "browser" })
  const asked = askMessage(at.nonce, at.host.key, "", key!, kind!, name!)
  expect(await signed(key!, asked, sig!)).toBe(true)
  // The key is one WebCrypto does not hand out.
  const pair = mine.held.get("key") as CryptoKeyPair
  expect(pair.privateKey.extractable).toBe(false)

  // Paired, it is kept: the door, as that device, signing with that key.
  expect(await device.paired()).toEqual({
    device: "device-7",
    hostKey: at.host.key,
  })
  const address = await device.engine()
  if (!("door" in address)) throw new Error("no door")
  expect(address).toMatchObject({
    url: "ws://door/ws",
    door: { device: "device-7", hostKey: at.host.key },
  })
  expect(await signed(key!, "hello", await address.door.sign("hello"))).toBe(
    true
  )

  // Another browser on what this one keeps is the same device.
  const again = browserDevice(mine, () => "ws://door/ws")
  expect(await again.paired()).toEqual(await device.paired())
  // Forgotten, it asks again under the same key.
  await device.forget()
  await expect(device.engine()).rejects.toThrow("has not paired")
  expect(mine.held.get("key")).toBe(pair)
})

test("an asking that is stopped before its key is made opens no door", async () => {
  const at = await door()
  const device = browserDevice(kept(), () => "ws://door/ws")
  const heard = vi.fn()
  device.pair({ name: "Safari", kind: "browser" }, heard)()
  await new Promise((done) => setTimeout(done, 50))
  expect(at.heard.url).toBeUndefined()
  expect(heard).not.toHaveBeenCalled()
})
