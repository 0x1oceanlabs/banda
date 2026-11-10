/**
 * A file's bytes by the machine that has them (ADR 0106, decision 6).
 * `relayed` answers the byte host and the sandbox host: a URL that names
 * another machine goes to its engine through its forward, as it listens
 * now, so a link goes on working when ssh comes back on a new port, and
 * one that names none to this machine's engine. Main still reads no
 * Project's path, here or there: a URL's token is all it knows of the
 * file.
 */
import type { Address } from "@banda/contract"
import { Engine, type Refused, relay } from "@banda/desktop-kit"
import { Effect } from "effect"
import { Hosts } from "./hosts"

/** Where a machine's engine listens, or why it is not to be had. */
type Where = Effect.Effect<Address, Refused, Engine | Hosts>

/** Where the engine that gave a token listens: this machine's, or another
 * machine's through its forward, which waits while that machine is away,
 * as a read may (ADR 0106, law 4). */
const engineOf = (machine: string | null): Where =>
  machine === null
    ? Engine.use((engine) => engine.address)
    : Hosts.use((hosts) => hosts.address(machine))

/** The answer to `request`, to `app://files` or `app://preview`. */
export const relayed = (request: Request) => relay(request, engineOf)
