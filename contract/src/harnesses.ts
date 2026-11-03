/**
 * What the window reads of a Harness, this computer's agent program
 * (ADR 0040): its entry in harnesses.toml, the Person's CLI it runs, a
 * program to start, and who is signed in to it, which the machine's module
 * `harnesses` answers.
 */
export type { Account } from "./generated/harnesses/Account"
export type { Accounted } from "./generated/harnesses/Accounted"
export type { Adapter } from "./generated/harnesses/Adapter"
export type { CliView } from "./generated/harnesses/CliView"
export type { HarnessView } from "./generated/harnesses/HarnessView"
export type { Program } from "./generated/harnesses/Program"
export type { SignedInAs } from "./generated/harnesses/SignedInAs"
export type { SignInWay } from "./generated/harnesses/SignInWay"
