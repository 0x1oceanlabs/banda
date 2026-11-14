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

/** An engine that answers each command with `answer`'s. */
const engine = (answer: (method: string, params: unknown) => unknown) => {
  const command = vi.fn(async (method: string, params: unknown) =>
    answer(method, params)
  )
  return { command, it: { command } as unknown as Engine }
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
  const device = {
    id: "device-7",
    key: "its-key",
    name: ASK.name,
    kind: ASK.kind,
    origin: ASK.origin,
  }
  const arc = engine(() => device)
  const devbox = engine(() => device)
  const mac = engine(() => {
    throw new Error("away")
  })
  const done = await allow(arc.it, ASK.code, [
    { engine: devbox.it, name: "devbox" },
    { engine: mac.it, name: "this Mac" },
  ])
  expect(arc.command.mock.calls).toEqual([
    ["devices.allow", { code: "4F7K-92QD" }],
  ])
  expect(devbox.command.mock.calls).toEqual([
    [
      "devices.add",
      {
        key: "its-key",
        name: "Safari on macOS",
        kind: "browser",
        origin: "https://arc.example.ts.net",
      },
    ],
  ])
  expect(done).toEqual({ device, missed: ["this Mac"] })
  // Only where it asked: no other machine hears of it.
  expect((await allow(arc.it, ASK.code)).missed).toEqual([])
})

test("a device not allowed where it asked is paired nowhere", async () => {
  const arc = engine(() => {
    throw new Error("No device asks with that code.")
  })
  const devbox = engine(() => ({}))
  await expect(
    allow(arc.it, ASK.code, [{ engine: devbox.it, name: "devbox" }])
  ).rejects.toThrow("No device asks")
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
