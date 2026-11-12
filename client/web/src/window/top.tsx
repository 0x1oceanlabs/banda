/**
 * The Top layer's part an App asked for (`WindowApi.top`): a dialog one
 * of its actions opens, as moving a Thread (ADR 0116, decision 7). The
 * Window keeps which part and its args, one at a time (ADR 0087), and
 * draws it with what it offers a module; the App keeps no store for it.
 */
import { useState } from "react"
import type { Args, KeptHosts } from "@banda/core"
import { Store, useStore } from "@banda/core/react"
import { tops } from "../registry"
import { type Shell, useWindowApi } from "./actions"

/** A part asked for, and its args; none while the Top layer holds none. */
export type TopAsked = { part: string; args: Args } | null

/**
 * What an App's act asks of the Window beyond its Panes (`WindowApi`): a
 * part of its own in the Top layer, which the Window keeps for its life
 * (`tops`), and the machines `hosts` reaches, this one by the name its
 * engine says it has, where the list leaves it unnamed (ADR 0095,
 * decision 4), as an act names it by.
 */
export function useTops(
  hosts: Pick<KeptHosts, "machines" | "hereNamed">
): Pick<Shell, "tops" | "top" | "machines"> {
  const [tops] = useState(() => new Store<TopAsked>(null))
  return {
    tops,
    top: (part, args = {}) => tops.set(part === null ? null : { part, args }),
    machines: () => {
      const named = hosts.hereNamed.get()
      const all = hosts.machines.get()
      return named
        ? all.map((one) => (one.host === undefined ? { ...one, named } : one))
        : all
    },
  }
}

const itself = (asked: TopAsked) => asked

/** Draws the part asked for, if a module has it. */
export function TopPart({ shell }: { shell: Shell }) {
  const window = useWindowApi(shell)
  const asked = useStore(shell.tops, itself)
  const part = asked && tops.get(asked.part)
  if (!asked || !part) return null
  return (
    <part.Part
      window={window}
      args={asked.args}
      onClose={() => shell.tops.set(null)}
    />
  )
}
