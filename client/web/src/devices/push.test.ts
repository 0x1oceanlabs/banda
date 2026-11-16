import { bytesOf } from "@banda/contract"
import { describe, expect, it } from "vitest"
import { type Browser, pushKey, standing } from "./push"

const browser = (over: Partial<Browser> = {}): Browser => ({
  app: false,
  pushes: true,
  standalone: undefined,
  permission: () => "default",
  worker: async () => undefined,
  ...over,
})

const worker = async () => ({}) as ServiceWorkerRegistration

describe("how pushes stand on a device", () => {
  it("Banda's app takes none, whatever its Chromium has", async () => {
    expect(await standing(browser({ app: true }))).toBe("none")
  })

  it("an iPhone's Safari takes them once the page is on the Home Screen", async () => {
    const safari = browser({ pushes: false, standalone: false })
    expect(await standing(safari)).toBe("home")
    // From the Home Screen of an iOS with no pushes for a page: none.
    expect(await standing(browser({ pushes: false, standalone: true }))).toBe(
      "none"
    )
    // A browser with none, as a page not served by TLS.
    expect(await standing(browser({ pushes: false }))).toBe("none")
  })

  it("the Person is asked until they answer the browser", async () => {
    expect(await standing(browser())).toBe("ask")
    expect(await standing(browser({ permission: () => "denied" }))).toBe(
      "denied"
    )
  })

  it("they are on where the browser allows them and the page has its worker", async () => {
    const allowed = browser({ permission: () => "granted" })
    // Allowed once, then turned off here: the worker went.
    expect(await standing(allowed)).toBe("ask")
    expect(await standing({ ...allowed, worker })).toBe("on")
  })
})

describe("a device's push key", () => {
  it("is made once and kept: a P-256 pair, as a machine reads it", async () => {
    const held = new Map<string, unknown>()
    const kept = {
      get: async <T>(name: string) => held.get(name) as T | undefined,
      set: async (name: string, value: unknown) => void held.set(name, value),
      remove: async (name: string) => void held.delete(name),
    }
    const made = await pushKey(kept)
    // Uncompressed public half, and the private one, with no padding.
    expect(bytesOf(made.key)).toHaveLength(65)
    expect(bytesOf(made.signs)).toHaveLength(32)
    expect(made.key + made.signs).not.toMatch(/[+/=]/)
    expect(await pushKey(kept)).toEqual(made)
  })
})
