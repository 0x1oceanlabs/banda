import type { Engine } from "@banda/contract"
import type { PairedDevice } from "@banda/contract/devices"
import { expect, test, vi } from "vitest"
import { pairedWords, remove } from "./paired"

const PHONE: PairedDevice = {
  id: "on-arc" as PairedDevice["id"],
  name: "iPhone",
  kind: "phone",
  key: "phone-key",
  origin: "https://arc.example.ts.net",
  here: false,
  added_at: 1_000,
}

/** A machine that paired `devices`, and what it was asked. */
function machine(devices: PairedDevice[] | "away") {
  const command = vi.fn(async () => null)
  const call = vi.fn(async () => {
    if (devices === "away") throw new Error("away")
    return { host_key: "host", devices }
  })
  return { command, it: { command, call } as unknown as Engine }
}

test("a device removed from every machine is found on each by its key, and a machine that does not answer is named", async () => {
  const arc = machine([PHONE])
  const devbox = machine([
    { ...PHONE, id: "on-devbox" as PairedDevice["id"] },
    { ...PHONE, id: "other" as PairedDevice["id"], key: "other-key" },
  ])
  const mac = machine([])
  const laptop = machine("away")
  const done = await remove(arc.it, PHONE, [
    { engine: devbox.it, name: "devbox" },
    { engine: mac.it, name: "this Mac" },
    { engine: laptop.it, name: "laptop" },
  ])
  expect(arc.command.mock.calls).toEqual([
    ["devices.remove", { device: "on-arc" }],
  ])
  expect(devbox.command.mock.calls).toEqual([
    ["devices.remove", { device: "on-devbox" }],
  ])
  // It never paired there: nothing to remove, and nothing missed.
  expect(mac.command).not.toHaveBeenCalled()
  expect(done).toEqual({ missed: ["laptop"] })
  // Only from one: no other machine is asked.
  expect(await remove(arc.it, PHONE)).toEqual({ missed: [] })
})

test("a row says a device's kind, when it was added and where its page came from", () => {
  expect(pairedWords(PHONE, 7_201_000)).toBe(
    "Phone · added 2h ago · from arc.example.ts.net"
  )
  expect(pairedWords(PHONE, 1_500)).toBe(
    "Phone · added now · from arc.example.ts.net"
  )
  expect(
    pairedWords({ ...PHONE, kind: "cli", origin: undefined }, 61_000)
  ).toBe("CLI · added 1m ago")
  expect(pairedWords({ ...PHONE, kind: "desktop", here: true }, 61_000)).toBe(
    "Desktop · this machine's window"
  )
})
