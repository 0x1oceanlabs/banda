import type { Status } from "@banda/contract"

/**
 * What the empty composer says (ADR 0058, decision 8). While a turn runs
 * that a message can go into, it is the way to steer the Thread; Enter
 * and the button still steer or queue as the Person chose (ADR 0010,
 * decision 7). Else it says whom the message goes to and what it can
 * name, and on another machine's Thread, which machine (ADR 0095,
 * decision 7). A Question or a plan that waits says its own, before this.
 */
export function placeholder(
  name: string,
  steering: boolean,
  skills: boolean,
  machine?: string
): string {
  if (steering) return "Steer this thread…"
  const to = machine === undefined ? name : `${name} on ${machine}`
  return `Write to ${to}. @ files, / commands${skills ? ", $ skills" : ""}`
}

/**
 * Why Send waits on another machine's Thread, while its engine's
 * connection, in `state`, is not open (ADR 0095, decision 7); nothing once
 * it is. Until the window has `tried` it, it is connecting. After, the
 * engine connects again only once the machine is back, so until then it
 * is away; and so for an engine that broke off or refused it.
 */
export function heldWords(
  machine: string,
  state: Status["state"],
  tried: boolean
): string | undefined {
  if (state === "open") return undefined
  if (state === "connecting" && !tried) return `Connecting to ${machine}…`
  return `${machine} is away. Send once it is back.`
}
