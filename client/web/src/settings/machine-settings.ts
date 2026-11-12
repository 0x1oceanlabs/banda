/**
 * Another machine's settings, as Settings shows them for it (ADR 0106,
 * decision 7, step 5b): only the machine's parts of its files, which that
 * machine's engine reads (`keys.settings_read`), follows
 * (`keys.settings_changed`) and writes (`keys.settings_set`). The rest of
 * every file stays this device's, as the look reads it here. Whose copy a
 * key is, its schema says (`x-class`).
 */
import { useEffect, useState } from "react"
import type { Engine } from "@banda/contract"
import type { Problem } from "@banda/contract/look"
import { type Setting, SCHEMAS } from "@banda/contract/settings"
import { problem } from "@banda/ui/lib/words"
import { device } from "../boot"

/** Whose copy `key` of `file` is (ADR 0101, decision 3): its top-level
 * key's class, else the file's, else the device's, as in doubt. */
export function classOf(file: string, key: string) {
  const schema = SCHEMAS[file]
  const top = key.split(".")[0]!
  return (
    schema?.properties?.[top]?.["x-class"] ?? schema?.["x-class"] ?? "device"
  )
}

/** Whether `file` has a part of the machine's. */
export const hasMachinePart = (file: string) =>
  Object.keys(SCHEMAS[file]?.properties ?? {}).some(
    (key) => classOf(file, key) === "machine"
  )

/** How a row writes its file: the words of what was wrong, none when it
 * was written. */
export type SettingsWriter = {
  set: (file: string, key: string, value: string) => Promise<string[]>
  reset: (file: string, key: string) => Promise<string[]>
}

/** This device's files, written through the desktop (`banda settings`). */
export const onThisDevice: SettingsWriter = device.settings

/** A machine's files, written through its engine as the Person (ADR 0108,
 * decision 1): a machine away refuses at once, in its words. */
export function throughEngine(engine: Engine): SettingsWriter {
  const said = (asked: Promise<unknown>) =>
    asked.then(
      (): string[] => [],
      (error: unknown) => problem(error).split("\n")
    )
  return {
    set: (file, key, value) =>
      said(engine.call("keys.settings_set", { file, key, value })),
    reset: (file, key) =>
      said(engine.call("keys.settings_reset", { file, key })),
  }
}

/** A machine's part of its files, as its engine read them last. */
export type MachineSettings = {
  /** Each file's keys of the machine's, as `useLookSettings` has them. */
  keyed: { [file: string]: { [key: string]: Setting } }
  problems: Problem[]
  /** Where each file is on that machine. */
  paths: { [file: string]: string }
}

const NOTHING: MachineSettings = { keyed: {}, problems: [], paths: {} }

/**
 * The machine's parts of `files` on `engine`, that machine's: read, and
 * read again as its engine says one changed. None while there is no
 * engine, and the last read while its machine is away, as of then.
 */
export function useMachineSettings(
  engine: Engine | undefined,
  files: readonly string[]
): MachineSettings {
  const [read, setRead] = useState<{
    engine: Engine
    settings: MachineSettings
  }>()
  const wanted = files.filter(hasMachinePart).join(" ")
  useEffect(() => {
    if (!engine || !wanted) return
    let current = true
    const kept: MachineSettings = { keyed: {}, problems: [], paths: {} }
    const byFile = new Map<string, Problem[]>()
    const readOne = (file: string) =>
      engine.call("keys.settings_read", { file }).then(
        (answer) => {
          if (!current) return
          kept.keyed[file] = answer.keyed
          kept.paths[file] = answer.path
          byFile.set(file, answer.problems)
          setRead({
            engine,
            settings: {
              keyed: { ...kept.keyed },
              paths: { ...kept.paths },
              problems: [...byFile.values()].flat(),
            },
          })
        },
        () => undefined
      )
    const names = new Set(wanted.split(" "))
    const stop = engine.stream(
      undefined,
      "keys.settings_changed",
      {},
      ({ file }) => {
        if (names.has(file)) void readOne(file)
      },
      () => undefined
    )
    return () => {
      current = false
      stop()
    }
  }, [engine, wanted])
  return read && read.engine === engine ? read.settings : NOTHING
}
