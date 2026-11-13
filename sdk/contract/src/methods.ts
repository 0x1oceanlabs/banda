/**
 * Every method of the engine, as its module declares it in Rust (ADR 0014,
 * decision 1): its params, its answer, and whether it is a call, a command
 * or a stream. `Engine.call`, `.command` and `.stream` take only these.
 * The engine's tests write `Methods` from the list of Apps (ADR 0062,
 * decision 11).
 */
import type { CommandId } from "./generated/CommandId"
import type { DOES } from "./generated/does"
import type { Methods } from "./generated/Methods"

export type { Methods }

type Kind = Methods[keyof Methods]["kind"]

/** The methods of one kind. */
export type MethodOf<K extends Kind> = {
  [M in keyof Methods]: Methods[M] extends { kind: K } ? M : never
}[keyof Methods]

/** The calls that read (ADR 0106, law 4): `Engine.read` takes these, and
 * answers each with when it was so. The rest of the calls, and every
 * command, act: `outcome()` says what each came to. */
export type ReadMethod = {
  [M in MethodOf<"call">]: (typeof DOES)[M] extends "read" ? M : never
}[MethodOf<"call">]

export type Params<M extends keyof Methods> = Methods[M]["params"]

/** What a method answers; a stream's piece. */
export type Answer<M extends keyof Methods> = Methods[M]["answer"]

/**
 * A command with its params and the ID it runs under, made in one place and
 * sent in another, as a Pane's args carry one to the Pane that sends it.
 */
export type CommandCall = {
  [M in MethodOf<"command">]: {
    method: M
    params: Params<M>
    command: CommandId
  }
}[MethodOf<"command">]
