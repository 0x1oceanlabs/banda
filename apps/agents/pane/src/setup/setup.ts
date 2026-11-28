/**
 * A Harness's setup in words (ADR 0140, decisions 6 and 9): what its row
 * says and the one button it has, and what its sheet's head says. All of
 * it from the steps the engine gave: this names no Harness. Pure, so plain
 * tests cover it; the row and the sheet only draw it.
 */
import type { Setup, SetupStep } from "@banda/contract/harnesses"

/** Who a row's colour calls: the Person, or no one, as it is broken or
 * ready. */
export type Tone = "asks" | "failed" | "ready"

export type RowWords = {
  line: string
  tone?: Tone
  /** What its one button says; none when there is nothing to do. */
  button?: string
}

const at = (setup: Setup, state: SetupStep["state"]) =>
  setup.steps.findIndex((step) => step.state === state)

/** The step that stopped a setup: the last one failed, as a later step
 * holds back more. None while it runs, or once it is ready. */
export function stoppedAt(setup: Setup): SetupStep | undefined {
  if (setup.running || setup.ready) return undefined
  return setup.steps.findLast((step) => step.state === "failed")
}

/** What a Harness's row says of its setup. */
export function rowOf(setup: Setup): RowWords {
  const { steps } = setup
  if (steps.length === 0) return { line: "Set up by you" }
  if (setup.running) {
    const asks = steps[at(setup, "asks")]
    if (asks)
      return {
        line: `Waits for you · ${asks.name}`,
        tone: "asks",
        button: "Show",
      }
    const running = Math.max(at(setup, "running"), 0)
    return {
      line: `Setting up · ${running + 1} of ${steps.length}`,
      button: "Show",
    }
  }
  if (setup.ready) return { line: "Ready", tone: "ready" }
  const stopped = stoppedAt(setup)
  if (stopped)
    return {
      line: `Stopped · ${stopped.note ?? stopped.name}`,
      tone: "failed",
      button: "Try again",
    }
  const installed = steps.some(
    (step) => step.id === "install" && step.state === "done"
  )
  return installed
    ? { line: "Not signed in", button: "Sign in" }
    : { line: "Not on this computer", button: "Set up" }
}

/** What a sheet's head says: its title, and a line under it. */
export function headOf(setup: Setup): { title: string; says: string } {
  const { name } = setup
  if (setup.running) {
    if (setup.login)
      return {
        title: `Sign in to ${name}`,
        says: "Its sign-in page opens in your browser. Sign in there, then come back.",
      }
    if (at(setup, "asks") >= 0)
      return {
        title: `Setting up ${name}`,
        says: "Your system asks you to allow the installer.",
      }
    return {
      title: `Setting up ${name}`,
      says: "You can close this. It goes on, and its row says where it is.",
    }
  }
  if (setup.ready)
    return { title: `${name} is ready`, says: "You can write to it now." }
  const stopped = stoppedAt(setup)
  if (stopped)
    return {
      title: "Setting up stopped",
      says: `${stopped.name} did not finish. You can try again.`,
    }
  const left = setup.steps.filter((step) => step.state !== "done")
  return {
    title: `Set up ${name}`,
    says: `${left.length === 1 ? "One step" : `${left.length} steps`}, a few minutes. Banda runs them, and asks you only to sign in.`,
  }
}

/** What a step says of itself at its right; nothing while it waits. */
export function stepWord(step: SetupStep): string | undefined {
  switch (step.state) {
    case "done":
      return "Done"
    case "running":
      return "Working"
    case "asks":
      return "Waits for you"
    case "failed":
      return "Stopped"
    default:
      return undefined
  }
}
