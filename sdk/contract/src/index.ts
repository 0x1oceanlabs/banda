/**
 * The engine's API for TypeScript (ADR 0001, decision 1). The types are
 * generated from the Rust; `scripts/check.sh` fails when they are stale.
 */
export type { AgentId } from "./generated/AgentId"
export type { App } from "./generated/App"
export type { AppMethods } from "./generated/AppMethods"
export type { Code } from "./generated/Code"
export type { EngineStatus } from "./generated/EngineStatus"
export type { CommandId } from "./generated/CommandId"
export type { Event } from "./generated/Event"
export type { EventFilter } from "./generated/EventFilter"
export type { EventId } from "./generated/EventId"
export type { Fence } from "./generated/Fence"
export type { FenceLayer } from "./generated/FenceLayer"
export type { FenceWhy } from "./generated/FenceWhy"
export type { Participant } from "./generated/Participant"
export type { PersonId } from "./generated/PersonId"
export type { Refusal } from "./generated/Refusal"
export type { ProjectId } from "./generated/ProjectId"
export type { ProjectSummary } from "./generated/ProjectSummary"
export type { Sign } from "./generated/Sign"
export type { SignColor } from "./generated/SignColor"
export type { SignKind } from "./generated/SignKind"
export type { SignPick } from "./generated/SignPick"
export type { PictureKind } from "./generated/PictureKind"
export type { Program } from "./generated/Program"
export type { Browsed } from "./generated/Browsed"
export type { BrowsedFolder } from "./generated/BrowsedFolder"
export type { Foreign } from "./generated/Foreign"
export type { ForeignWhy } from "./generated/ForeignWhy"
export type { UpdateProject } from "./generated/UpdateProject"
export type { JsonValue } from "./generated/serde_json/JsonValue"
export type { MachineIcon } from "./generated/MachineIcon"
export type { Named } from "./generated/Named"
export type { WindowAnswer } from "./generated/WindowAnswer"
export type { WindowRequest } from "./generated/WindowRequest"
export {
  Engine,
  Lost,
  PING,
  PROTOCOL,
  Refused,
  Unreachable,
  type Address,
  type Answered,
  type CommandOptions,
  type Ping,
  type Status,
} from "./engine"
export { newId } from "./ids"
export { quitAsks, type QuitAsks } from "./quit"
export type { Answer, CommandCall, MethodOf, Methods, Params } from "./methods"
