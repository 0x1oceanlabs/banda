import type { Engine } from "@banda/contract"
import type { Ask } from "@banda/contract/devices"
import { expect, test, vi } from "vitest"
import { allow, askedWords, hearAsking, named } from "./asking"

const ASK: Ask = {
  code: "4F7K-92QD",
  name: "Safari on macOS",
  kind: "browser",
  origin: "https://arc.example.ts.net",
  asked_at: 1_000,
  until: 301_000,
}

/** A machine's engine: what it paired the device as, where its door is
 * served, and what it was asked. `away` refuses every command. */
function machine(id: string, doors: string[] | "away") {
  const device = {
    id,
    key: "its-key",
    name: ASK.name,
    kind: ASK.kind,
    origin: ASK.origin,
  }
  const command = vi.fn<
    (method: string, params: unknown) => Promise<typeof device>
  >(async () => {
    if (doors === "away") throw new Error("away")
    return device
  })
  const call = vi.fn(async () => ({
    host_key: `key-of-${id}`,
    devices: [],
    doors,
  }))
  return { command, device, it: { command, call } as unknown as Engine }
}

test("a window hears who asks at a door, and no one once its engine ends the stream", () => {
  const stream = vi.fn(
    (
      _project: undefined,
      _method: string,
      _params: object,
      piece: (asking: Ask[]) => void,
      end: () => void
    ) => {
      piece([ASK])
      end()
      return () => {}
    }
  )
  const heard = vi.fn()
  hearAsking({ stream } as unknown as Engine, heard)
  expect(stream.mock.calls[0]!.slice(0, 3)).toEqual([
    undefined,
    "devices.asking",
    {},
  ])
  expect(heard.mock.calls).toEqual([[[ASK]], [[]]])
})

test("a device allowed where it asked is paired on the others by the key it proved there, and one that refuses is named", async () => {
  const arc = machine("on-arc", ["https://arc.example.ts.net"])
  const devbox = machine("on-devbox", ["https://devbox.example.ts.net"])
  const mac = machine("on-mac", "away")
  const done = await allow({ engine: arc.it, name: "arc" }, ASK.code, [
    { engine: devbox.it, name: "devbox" },
    { engine: mac.it, name: "this Mac" },
  ])
  expect(arc.command.mock.calls[0]).toEqual([
    "devices.allow",
    { code: "4F7K-92QD" },
  ])
  expect(devbox.command.mock.calls[0]).toEqual([
    "devices.add",
    {
      key: "its-key",
      name: "Safari on macOS",
      kind: "browser",
      origin: "https://arc.example.ts.net",
    },
  ])
  expect(done).toEqual({ device: arc.device, missed: ["this Mac"] })
  // Each machine it joined is handed the other, by its own host key and
  // door, with the device it is there; the one that refused, nothing.
  expect(arc.command.mock.calls[1]).toEqual([
    "devices.hand",
    {
      device: "on-arc",
      machines: [
        {
          name: "devbox",
          host_key: "key-of-on-devbox",
          door: "https://devbox.example.ts.net",
          device: "on-devbox",
        },
      ],
    },
  ])
  expect(devbox.command.mock.calls[1]).toEqual([
    "devices.hand",
    {
      device: "on-devbox",
      machines: [
        {
          name: "arc",
          host_key: "key-of-on-arc",
          door: "https://arc.example.ts.net",
          device: "on-arc",
        },
      ],
    },
  ])
  expect(mac.command).toHaveBeenCalledTimes(1)
})

test("a machine that serves its door nowhere is handed to no device, and one machine alone hands nothing", async () => {
  const arc = machine("on-arc", ["https://arc.example.ts.net"])
  const mac = machine("on-mac", [])
  await allow({ engine: arc.it, name: "arc" }, ASK.code, [
    { engine: mac.it, name: "this Mac" },
  ])
  expect(arc.command.mock.calls[1]).toEqual([
    "devices.hand",
    { device: "on-arc", machines: [] },
  ])
  expect(mac.command.mock.calls[1]![1]).toMatchObject({
    machines: [{ name: "arc", door: "https://arc.example.ts.net" }],
  })
  // Only where it asked: no other machine hears of it, and no list goes.
  const alone = machine("on-arc", ["https://arc.example.ts.net"])
  const only = await allow({ engine: alone.it, name: "arc" }, ASK.code)
  expect(only.missed).toEqual([])
  expect(alone.command).toHaveBeenCalledTimes(1)
})

test("a device not allowed where it asked is paired nowhere", async () => {
  const arc = machine("on-arc", "away")
  const devbox = machine("on-devbox", [])
  await expect(
    allow({ engine: arc.it, name: "arc" }, ASK.code, [
      { engine: devbox.it, name: "devbox" },
    ])
  ).rejects.toThrow("away")
  expect(devbox.command).not.toHaveBeenCalled()
})

test("an asking says its kind, when it asked and the page's address it asks from", () => {
  expect(askedWords(ASK, 1_500)).toBe(
    "Browser · asked now · from arc.example.ts.net"
  )
  expect(askedWords({ ...ASK, kind: "phone" }, 121_000)).toBe(
    "Phone · asked 2m ago · from arc.example.ts.net"
  )
  expect(askedWords({ ...ASK, origin: "http://127.0.0.1:22633" }, 1_500)).toBe(
    "Browser · asked now · from 127.0.0.1:22633"
  )
  expect(askedWords({ ...ASK, kind: "cli", origin: undefined }, 1_500)).toBe(
    "CLI · asked now · not from a page"
  )
})

test("machines read as a row", () => {
  expect(named(["arc"])).toBe("arc")
  expect(named(["arc", "this Mac"])).toBe("arc and this Mac")
  expect(named(["arc", "devbox", "this Mac"])).toBe("arc, devbox and this Mac")
})
