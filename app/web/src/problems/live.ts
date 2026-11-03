/**
 * The Problems the engine keeps (ADR 0039), read once and kept current
 * by the problems module's events, and how the window names them.
 */
import type { Engine, Event } from "@banda/contract"
import type { Listed, Problem } from "@banda/contract/problems"
import { useMemo } from "react"
import { type Live, type Source, useLive } from "@banda/ui/hooks/use-live"
import { useMachine } from "@banda/ui/hooks/use-status"

/** The Problems, the newest first, from the machine's log. A Problem
 * that breaks again says nothing, so its count is the read's. */
export function problemsSource(engine: Engine): Source<Listed> {
  return {
    read: () => engine.call("problems.list", {}),
    filter: { module: "problems", kinds: ["recorded"] },
    apply: (listed, event: Event) => {
      const problem = event.payload as Problem
      const others = listed.problems.filter(
        (one) => one.fingerprint !== problem.fingerprint
      )
      return { at: event.seq, problems: [problem, ...others] }
    },
  }
}

/** Where it broke, in the Person's words. */
export const PLACES: Record<Problem["source"], string> = {
  page: "the window",
  main: "the window",
  engine: "the engine",
  crash: "a process that crashed",
}

/** The Problems, kept current, once the engine says its machine's log. */
export function useProblems(engine: Engine): Live<Listed> {
  const machine = useMachine(engine)
  const source = useMemo(
    () => (machine ? problemsSource(engine) : null),
    [engine, machine]
  )
  return useLive(engine, machine ?? "", source)
}

/** The Problems section's link, at one Problem. */
export const problemLink = (fingerprint: string) => `problems/${fingerprint}`
