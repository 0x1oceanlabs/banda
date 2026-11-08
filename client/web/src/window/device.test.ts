import { afterEach, expect, test, vi } from "vitest"
import { device } from "./device"

afterEach(() => vi.unstubAllGlobals())

test("without the desktop each part does nothing, and the settings say why they are not written", async () => {
  vi.stubGlobal("window", {})
  expect(device.popped.follow(() => undefined)).toBeUndefined()
  expect(device.popped.asked(() => undefined)).toBeUndefined()
  expect(device.menu.listen(() => undefined)).toBeUndefined()
  expect(device.files.exists("/a")).toBeUndefined()
  expect(() => device.quit()).not.toThrow()
  expect(() => device.sidebar.preset("inbox")).not.toThrow()
  expect(await device.settings.set("look.toml", "a", "1")).toEqual([
    "Only Banda's app writes the settings.",
  ])
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
