/**
 * Another machine's pinned folders (ADR 0106, decision 7, step 5b):
 * `files.toml`'s `pinned` is the machine's, so Files on arc shows arc's
 * pins, read through arc's engine as they change, and pins there. This
 * machine's Files keeps its own, as the look reads them here.
 */
import { useEffect, useState } from "react"
import type { Engine } from "@banda/contract"
import { tomlOf } from "@banda/contract/settings"

const FILE = "files.toml"
const NONE: readonly string[] = []

/** The pins `engine`'s machine keeps, as written (`~/code`), read again as
 * it says the file changed; none while unread, and none with no engine. */
export function useMachinePins(engine: Engine | undefined): readonly string[] {
  const [read, setRead] = useState<{ engine: Engine; pins: string[] }>()
  useEffect(() => {
    if (!engine) return
    let current = true
    const ask = () =>
      engine.call("keys.settings_read", { file: FILE }).then(
        ({ keyed }) => {
          const value = keyed.pinned?.value
          const pins = Array.isArray(value)
            ? value.filter((one): one is string => typeof one === "string")
            : []
          if (current) setRead({ engine, pins })
        },
        () => undefined
      )
    const stop = engine.stream(
      undefined,
      "keys.settings_changed",
      {},
      ({ file }) => {
        if (file === FILE) void ask()
      },
      () => undefined
    )
    return () => {
      current = false
      stop()
    }
  }, [engine])
  return read && read.engine === engine ? read.pins : NONE
}

/** Pins `dir`, as written, on `engine`'s machine, or unpins it, from the
 * pins it has now: an act, refused at once while it is away. */
export function pinThere(
  engine: Engine,
  now: readonly string[],
  dir: string,
  pin: boolean
): Promise<unknown> {
  const next = [...now.filter((one) => one !== dir), ...(pin ? [dir] : [])]
  return engine.call("keys.settings_set", {
    file: FILE,
    key: "pinned",
    value: tomlOf(next),
  })
}
