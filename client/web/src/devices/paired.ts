/**
 * The devices a machine paired, as Settings → Devices lists and removes
 * them (ADR 0124, decisions 3 and 4; SE5). A device is one key: removed
 * from every machine, it is found on each by that key, as each machine
 * keeps it under an ID of its own.
 */
import type { Engine } from "@banda/contract"
import type { PairedDevice } from "@banda/contract/devices"
import { short } from "@banda/ui/lib/words"
import { addressOf, KINDS, type Reached } from "./asking"

/**
 * Removes `device` from the machine of `at`, then from each of `others`
 * that paired its key. Says the machines of `others` that did not answer:
 * it still reaches those.
 */
export async function remove(
  at: Engine,
  device: Pick<PairedDevice, "id" | "key">,
  others: readonly Reached[] = []
): Promise<{ missed: string[] }> {
  await at.command("devices.remove", { device: device.id })
  const removed = await Promise.allSettled(
    others.map(async ({ engine }) => {
      const { devices } = await engine.call("devices.list", {})
      const theirs = devices.find((one) => one.key === device.key)
      if (theirs) await engine.command("devices.remove", { device: theirs.id })
    })
  )
  return {
    missed: others
      .filter((_, i) => removed[i]!.status === "rejected")
      .map(({ name }) => name),
  }
}

/**
 * What a row says under a device's name: its kind, then that it is this
 * machine's own window, or when it was added and the address of the page
 * it paired from: "Browser · added 2h ago · from arc.example.ts.net".
 */
export function pairedWords(
  { kind, here, added_at, origin }: PairedDevice,
  now: number
): string {
  if (here) return `${KINDS[kind]} · this machine's window`
  const ago = short(added_at, now)
  return [
    KINDS[kind],
    /^\d/.test(ago) ? `added ${ago} ago` : `added ${ago}`,
    ...(origin === undefined ? [] : [`from ${addressOf(origin)}`]),
  ].join(" · ")
}
