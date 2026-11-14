import { afterEach, expect, test, vi } from "vitest"
import { browser } from "./browser"
import { device, ELSEWHERE } from "./desktop"

// A browser's own keeping is IndexedDB, which a test has none of.
vi.mock("./browser", () => ({
  browser: {
    hosts: {
      follow: vi.fn(() => () => undefined),
      engine: () =>
        Promise.reject(new Error("This browser was not let in there.")),
    },
  },
}))

afterEach(() => vi.unstubAllGlobals())

test("without the desktop each part does nothing, and the settings say why they are not written", async () => {
  vi.stubGlobal("window", {})
  expect(device.popped.follow(() => undefined)).toBeUndefined()
  expect(device.popped.asked(() => undefined)).toBeUndefined()
  expect(device.act.asked(() => undefined)).toBeUndefined()
  expect(() => device.act.answer({ id: 0 })).not.toThrow()
  expect(device.menu.listen(() => undefined)).toBeUndefined()
  expect(device.files.exists("/a")).toBeUndefined()
  expect(() => device.quit()).not.toThrow()
  expect(() => device.sidebar.edit()).not.toThrow()
  expect(await device.settings.set("look.toml", "a", "1")).toEqual([
    "Only Banda's app writes the settings.",
  ])
})

test("the device says it can save a copy where the desktop does, and in a page of its own it cannot", () => {
  vi.stubGlobal("window", {})
  expect(device.has("save_file")).toBe(false)
  expect(device.has("clipboard")).toBe(true)
  vi.stubGlobal("window", { banda: {} })
  expect(device.has("save_file")).toBe(true)
})

test("the Panes in windows of their own come now and as they change, and nothing after the stop", async () => {
  let answer: (ids: string[]) => void = () => undefined
  let tell: (ids: string[]) => void = () => undefined
  const stopped = vi.fn()
  vi.stubGlobal("window", {
    banda: {
      popped: {
        current: () => new Promise<string[]>((done) => (answer = done)),
        listen: (listener: (ids: string[]) => void) => {
          tell = listener
          return stopped
        },
      },
    },
  })
  const taken: string[][] = []
  const stop = device.popped.follow((panes) => taken.push([...panes]))
  answer(["a"])
  await Promise.resolve()
  tell(["a", "b"])
  expect(taken).toEqual([["a"], ["a", "b"]])

  // A first answer that comes after the stop is dropped.
  const late = device.popped.follow((panes) => taken.push([...panes]))
  late?.()
  answer(["c"])
  await Promise.resolve()
  expect(taken).toEqual([["a"], ["a", "b"]])
  stop?.()
  expect(stopped).toHaveBeenCalledTimes(2)
})

test("the hosts come now and as they change, a change before the first answer wins, and without the desktop none is reached", async () => {
  let answer: (hosts: unknown[]) => void = () => undefined
  let tell: (hosts: unknown[]) => void = () => undefined
  vi.stubGlobal("window", {
    banda: {
      hosts: {
        current: () => new Promise((done) => (answer = done)),
        listen: (listener: (hosts: unknown[]) => void) => {
          tell = listener
          return () => undefined
        },
      },
    },
  })
  const taken: unknown[] = []
  device.hosts.follow((hosts) => taken.push(hosts))
  tell(["newer"])
  answer(["older"])
  await Promise.resolve()
  expect(taken).toEqual([["newer"]])

  // A first answer that fails is said, and the changes still come.
  const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.stubGlobal("window", {
    banda: {
      hosts: {
        current: () => Promise.reject(new Error("gone")),
        listen: (listener: (hosts: unknown[]) => void) => {
          tell = listener
          return () => undefined
        },
      },
    },
  })
  device.hosts.follow((hosts) => taken.push(hosts))
  await Promise.resolve()
  expect(warned).toHaveBeenCalledOnce()
  tell(["later"])
  expect(taken.at(-1)).toEqual(["later"])
  warned.mockRestore()

  // With no desktop, as in a browser, the hosts are those its machine
  // handed it (`browser.ts`); the rest of a host's part does nothing.
  vi.stubGlobal("window", {})
  expect(device.hosts.alone).toBe(true)
  const handed = vi.fn()
  device.hosts.follow(handed)()
  expect(browser.hosts.follow).toHaveBeenCalledWith(handed)
  await expect(device.hosts.engine("arc")).rejects.toThrow("not let in")
  await expect(device.hosts.remove("arc")).rejects.toThrow(ELSEWHERE)
  expect(() => device.hosts.start("arc")).not.toThrow()
})
