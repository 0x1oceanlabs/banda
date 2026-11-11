/**
 * A file's bytes by the machine that has them (ADR 0106, decision 6).
 * `relayed` answers the byte host and the sandbox host: a URL that names
 * another machine goes to its engine through its forward, as it listens
 * now, so a link goes on working when ssh comes back on a new port, and
 * one that names none to this machine's engine. `saveCopy` is the device's
 * `save_file`, the same road for a copy the Person keeps. Main still reads
 * no Project's path, here or there: a URL's token is all it knows of the
 * file.
 */
import type { Address } from "@banda/contract"
import { copyTo, Engine, namedBy, Refused, relay } from "@banda/desktop-kit"
import { Effect } from "effect"
import { Hosts } from "./hosts"

/** Where a machine's engine listens, or why it is not to be had. */
type Where = Effect.Effect<Address, Refused, Engine | Hosts>

/** Where the engine that gave a token listens: this machine's, or another
 * machine's through its forward, which waits while that machine is away,
 * as a read may (ADR 0106, law 4). A URL can come from a page in a sandbox
 * that names any machine it likes, so a read never has a refused machine
 * tried again (`addressWhenBack`); only the Person opening one does. */
const engineOf = (machine: string | null): Where =>
  machine === null
    ? Engine.use((engine) => engine.address)
    : Hosts.use((hosts) => hosts.addressWhenBack(machine))

/** The answer to `request`, to `app://files` or `app://preview`. */
export const relayed = (request: Request) => relay(request, engineOf)

/** The answer of those two hosts to `url`, asked as `request` was: what a
 * module's host asks for a page of its own, as a Visual's (`Relayed`). */
export const relayedAs = (request: Request, url: string) =>
  relay(request, engineOf, url)

/** Where that engine listens now, and none while its machine is away: a
 * gesture goes now or says why not (ADR 0106, law 4). This machine is
 * never away, and its engine between runs is waited for: seconds. */
const engineNow = (
  machine: string | null
): Effect.Effect<Address | undefined, never, Engine | Hosts> =>
  machine === null
    ? Engine.use((engine) => engine.address)
    : Hosts.use((hosts) => hosts.addressNow(machine))

/**
 * Saves a copy on this device of the file the byte-host URL `url` names,
 * the capability `save_file` (ADR 0106, decision 6): `pick` asks the
 * Person where, offering `name`, and only then the bytes are fetched, from
 * the machine that has them. They land whole or not at all (`copyTo`), so
 * a link that ends halfway leaves nothing at the place the Person picked.
 * The address is asked again after the dialog, since the Person may take a
 * while and ssh come back on a new port.
 *
 * `away` while that machine is away, before the dialog or after it, and
 * if the link ended halfway and it is away by then; `canceled` when the
 * Person cancels, with no byte asked for. Fails, saying why, for a URL that
 * is not a file's, an engine that will not give the file, or a disk that
 * refuses it.
 */
export const saveCopy = (
  url: string,
  name: string,
  pick: (name: string) => Effect.Effect<string | null>
) =>
  Effect.gen(function* () {
    const named = namedBy(url)
    if (named?.route !== "b")
      return yield* new Refused({ message: "That is not a file's link." })
    if ((yield* engineNow(named.machine)) === undefined) return "away"
    const path = yield* pick(name)
    if (path === null) return "canceled"
    const address = yield* engineNow(named.machine)
    if (address === undefined) return "away"
    return yield* Effect.tryPromise({
      try: () => copyTo(named, address.url, path),
      catch: (error) =>
        new Refused({
          message: `The copy was not saved: ${error instanceof Error ? error.message : String(error)}`,
        }),
    }).pipe(
      Effect.as("saved" as const),
      Effect.catch((refused) =>
        Effect.flatMap(engineNow(named.machine), (now) =>
          now === undefined
            ? Effect.succeed<"saved" | "away">("away")
            : Effect.fail(refused)
        )
      )
    )
  })
