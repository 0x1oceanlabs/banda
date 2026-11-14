/**
 * The devices that ask at a machine's door to be paired, as a window
 * that is the Person there hears them and answers (ADR 0124, decision 3;
 * SE5): on this machine and on each other the window reaches. Allowed
 * on the machine it asked, a device is paired on the others by its key,
 * which that machine says once it paired it, so one gesture lets it in
 * at every door the window reaches.
 */
import type { Engine } from "@banda/contract"
import type {
  Ask,
  DeviceKind,
  Machine,
  PairedDevice,
} from "@banda/contract/devices"
import { short } from "@banda/ui/lib/words"

/** A machine a window reaches: its engine, and what the window calls
 * it, "arc" or "this Mac". */
export type Reached = { engine: Engine; name: string }

/** A device that asks, and the machine whose door it asks at. */
export type Asked = { ask: Ask; at: Reached }

/** Hands `heard` the devices that ask at `engine`'s door now, and again
 * as that changes; none once its engine ends the stream, as one from
 * before pairing by code refuses it. Returns how to stop. */
export const hearAsking = (
  engine: Engine,
  heard: (asking: readonly Ask[]) => void
): (() => void) =>
  engine.stream(undefined, "devices.asking", {}, heard, () => heard([]))

/**
 * Allows the device that asks at the machine `at` with `code`, then pairs
 * it on each of `others` by the key it proved there, and hands it, on
 * each machine it joined, the others it joined: their names, host keys
 * and doors, so the browser it is reaches them all from the one whose
 * door it opened. A machine that serves its door nowhere is handed to
 * none. Says the device, and the machines of `others` that did not pair
 * it: it asks at each of those again.
 */
export async function allow(
  at: Reached,
  code: string,
  others: readonly Reached[] = []
): Promise<{ device: PairedDevice; missed: string[] }> {
  const device = await at.engine.command("devices.allow", { code })
  const { key, name, kind, origin } = device
  const paired = await Promise.allSettled(
    others.map(({ engine }) =>
      engine.command("devices.add", { key, name, kind, origin })
    )
  )
  const joined = [
    { machine: at, device },
    ...others.flatMap((machine, i) => {
      const one = paired[i]!
      return one.status === "fulfilled" ? [{ machine, device: one.value }] : []
    }),
  ]
  if (joined.length > 1) await hand(joined)
  return {
    device,
    missed: others
      .filter((_, i) => paired[i]!.status === "rejected")
      .map(({ name }) => name),
  }
}

/** Hands a device, on each machine it `joined`, the others of them, as
 * each says its own host key and door. One that says no door, or does
 * not answer, is left out; one that does not take the list, as an engine
 * from before it, keeps none, and the device reaches it alone there. */
async function hand(
  joined: readonly { machine: Reached; device: PairedDevice }[]
): Promise<void> {
  const known = await Promise.all(
    joined.map(async ({ machine, device }): Promise<Machine | undefined> => {
      try {
        const { host_key, doors } = await machine.engine.call(
          "devices.list",
          {}
        )
        const door = doors?.[0]
        if (door === undefined) return undefined
        return { name: machine.name, host_key, door, device: device.id }
      } catch {
        return undefined
      }
    })
  )
  await Promise.allSettled(
    joined.map(({ machine, device }, here) =>
      machine.engine.command("devices.hand", {
        device: device.id,
        machines: known.filter(
          (one, i): one is Machine => one !== undefined && i !== here
        ),
      })
    )
  )
}

const LIST = new Intl.ListFormat("en-GB", { type: "conjunction" })

/** Machines as one reads them in a row: "arc, devbox and this Mac". */
export const named = (names: readonly string[]): string => LIST.format(names)

export const KINDS: Record<DeviceKind, string> = {
  desktop: "Desktop",
  browser: "Browser",
  phone: "Phone",
  cli: "CLI",
}

/**
 * What a window says of a device that asks, under its code: its kind,
 * when it asked, and the address of the page that asks, which is all
 * that tells the Person's own browser from another page that reached the
 * door: "Browser · asked now · from arc.example.ts.net".
 */
export function askedWords({ kind, asked_at, origin }: Ask, now: number) {
  const ago = short(asked_at, now)
  return [
    KINDS[kind],
    ago === "now" ? "asked now" : `asked ${ago} ago`,
    origin === undefined ? "not from a page" : `from ${addressOf(origin)}`,
  ].join(" · ")
}

/** An origin's host, and its port where it has one; as it is, where it
 * is no address. */
export function addressOf(origin: string): string {
  try {
    return new URL(origin).host || origin
  } catch {
    return origin
  }
}
