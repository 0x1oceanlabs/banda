/**
 * What the window reads of a Harness, this computer's agent program
 * (ADR 0040): its entry in harnesses.toml, the Person's CLI it runs, a
 * program to start, who is signed in to it, and how much of its usage
 * limits is spent (ADR 0043), which the machine's module `harnesses`
 * answers.
 */
export type { Account } from "./generated/harnesses/Account"
export type { Accounted } from "./generated/harnesses/Accounted"
export type { Adapter } from "./generated/harnesses/Adapter"
export type { CliView } from "./generated/harnesses/CliView"
export type { HarnessView } from "./generated/harnesses/HarnessView"
export type { Limits } from "./generated/harnesses/Limits"
export type { LimitsFailed } from "./generated/harnesses/LimitsFailed"
export type { LimitsNow } from "./generated/harnesses/LimitsNow"
export type { LimitWindow } from "./generated/harnesses/LimitWindow"
export type { Program } from "./generated/harnesses/Program"
export type { SignedInAs } from "./generated/harnesses/SignedInAs"
export type { SignInWay } from "./generated/harnesses/SignInWay"
export type { WindowKind } from "./generated/harnesses/WindowKind"
