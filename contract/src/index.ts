/**
 * The engine's API for TypeScript (ADR 0001, decision 1). The types are
 * generated from the Rust; `scripts/check.sh` fails when they are stale.
 */
export type { AgentId } from "./generated/AgentId"
export type { Code } from "./generated/Code"
export type { CommandId } from "./generated/CommandId"
export type { Event } from "./generated/Event"
export type { EventFilter } from "./generated/EventFilter"
export type { EventId } from "./generated/EventId"
export type { Participant } from "./generated/Participant"
export type { PersonId } from "./generated/PersonId"
export type { Refusal } from "./generated/Refusal"
export type { SpaceId } from "./generated/SpaceId"
export type { SpaceSummary } from "./generated/SpaceSummary"
export type { Browsed } from "./generated/Browsed"
export type { BrowsedFolder } from "./generated/BrowsedFolder"
export type { UpdateSpace } from "./generated/UpdateSpace"
export type { JsonValue } from "./generated/serde_json/JsonValue"
export type { WindowAnswer } from "./generated/WindowAnswer"
export type { WindowRequest } from "./generated/WindowRequest"
export {
  Engine,
  Lost,
  PROTOCOL,
  Refused,
  type Address,
  type Status,
} from "./engine"
export { newId } from "./ids"
export type { Answer, CommandCall, MethodOf, Methods, Params } from "./methods"
