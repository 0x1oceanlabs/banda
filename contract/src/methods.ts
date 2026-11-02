/**
 * Every method of the engine, as its module declares it in Rust (ADR 0014,
 * decision 1): its params, its answer, and whether it is a call, a command
 * or a stream. `Engine.call`, `.command` and `.stream` take only these.
 */
import type { CommandId } from "./generated/CommandId"
import type { SpacesMethods } from "./generated/SpacesMethods"
import type { AgentsMethods } from "./generated/agents/AgentsMethods"
import type { TerminalMethods } from "./generated/terminal/TerminalMethods"
import type { WorkspacesMethods } from "./generated/workspaces/WorkspacesMethods"

/** A module's methods under its prefix: `send` becomes `agents.send`. */
type Prefixed<P extends string, M> = {
  [K in keyof M & string as `${P}.${K}`]: M[K]
}

export type Methods = Prefixed<"spaces", SpacesMethods> &
  Prefixed<"agents", AgentsMethods> &
  Prefixed<"terminal", TerminalMethods> &
  Prefixed<"workspaces", WorkspacesMethods>

type Kind = Methods[keyof Methods]["kind"]

/** The methods of one kind. */
export type MethodOf<K extends Kind> = {
  [M in keyof Methods]: Methods[M] extends { kind: K } ? M : never
}[keyof Methods]

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
