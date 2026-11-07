/** Events as the engine sends them, for this module's tests. */
import type { Event, Participant } from "@banda/contract"

export const person: Participant = { kind: "person", id: "p" }
export const agent: Participant = { kind: "agent", id: "a" }

let seq = 0

export function event(
  kind: string,
  payload: object,
  options: { author?: Participant; subject?: string; version?: number } = {}
): Event {
  seq += 1
  return {
    seq,
    id: `e${seq}`,
    module: "agents",
    kind,
    version: options.version ?? 1,
    subject: options.subject ?? "t",
    author: options.author ?? agent,
    at: seq,
    payload,
  }
}
