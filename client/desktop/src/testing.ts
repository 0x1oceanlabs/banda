/** Helpers for main's unit tests (`*.test.ts`). */
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"

/** A shell script in a folder of its own; returns its path. */
export function script(text: string): string {
  const program = join(mkdtempSync(join(tmpdir(), "banda-test-")), "program")
  writeFileSync(program, `#!/bin/sh\n${text}\n`, { mode: 0o755 })
  return program
}

/** The app as os-window/quitting.ts and asked.ts use it (`App`), faked:
 * what it `did`, in order, who listens to it, and what it is asked from
 * outside. A system dialog is answered `yes`. */
export function fakeApp(platform: NodeJS.Platform, yes = false) {
  type Heard = (event: { preventDefault: () => void }) => void
  const did: string[] = []
  const listeners = new Map<string, Set<Heard>>()
  const power = new Set<() => void>()
  return {
    did,
    app: {
      platform,
      quit: () => void did.push("quit"),
      listen: (event: string, heard: Heard) => {
        const all = listeners.get(event) ?? new Set()
        listeners.set(event, all.add(heard))
        return () => void all.delete(heard)
      },
      onPowerOff: (off: () => void) => {
        power.add(off)
        return () => void power.delete(off)
      },
      focus: () => void did.push("focus"),
      confirm: (over: unknown, ask: { message: string }) =>
        Effect.sync(() => {
          did.push(`${over ? "over the window" : "alone"}: ${ask.message}`)
          return yes
        }),
    },
    /** How many listen to the app, its power included. */
    listening: () =>
      power.size + [...listeners.values()].reduce((n, all) => n + all.size, 0),
    /** The app is asked `event`; whether a listener stopped it. */
    asked: (event: string) => {
      let stopped = false
      for (const heard of listeners.get(event) ?? [])
        heard({ preventDefault: () => (stopped = true) })
      return stopped
    },
    /** The system says it logs out, restarts or shuts down. */
    powerOff: () => {
      for (const off of power) off()
    },
  }
}
