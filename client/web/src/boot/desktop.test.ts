import { afterEach, expect, test, vi } from "vitest"
import { device } from "./desktop"

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

  vi.stubGlobal("window", {})
  expect(device.hosts.follow(() => undefined)).toBeUndefined()
  await expect(device.hosts.engine("arc")).rejects.toThrow()
  expect(() => device.hosts.start("arc")).not.toThrow()
})
