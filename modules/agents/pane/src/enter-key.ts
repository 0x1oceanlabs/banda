/**
 * What Enter does with a message written while the Agent works: Steering,
 * so the Agent reads it as it works (T3 Code's default), or the Queue, so
 * it waits until the turn ends. Ctrl (⌘ on a Mac) does the other. The
 * Person chooses it in `agents.toml` (ADR 0016), which comes with the look.
 */
import type { Enter } from "@banda/contract/look"
import { useLook } from "@banda/ui/lib/look"

/** What Enter does now; Banda's own before the look comes. */
export function useEnterKey(): Enter {
  return useLook((look) => look.agents.enter, "steer")
}

/** Whether a message sent with Enter, or with Ctrl+Enter when `other`,
 * goes into the turn that runs. */
export function steers(enter: Enter, other: boolean): boolean {
  return (enter === "steer") !== other
}

/** The key that sends a message `how`. */
export function keyFor(enter: Enter, how: Enter): string {
  return enter === how ? "Enter" : "Ctrl+Enter"
}
