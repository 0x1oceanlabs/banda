/**
 * The bridge's answers of the machines' engines, beside the root (ADR
 * 0089, decision 9): this machine's own (engine.ts), and those of the
 * machines in `hosts.toml`, which the page adds, takes out, tests,
 * starts and stops (hosts.ts, ADR 0081, ADR 0095). The root spreads them
 * into its table.
 */
import { Effect, Schema } from "effect"
import { type Answers, none, tellPage, text } from "@banda/desktop-kit"
import { BRIDGE } from "./bridge"
import { OwnEngine } from "./engine"
import { signedHello } from "./forward"
import { Hosts, terminalArgs } from "./hosts"

/** The parts of the bridge's table answered here. */
type Machines = Pick<
  typeof BRIDGE,
  | "engine"
  | "hosts"
  | "hostEngine"
  | "sign"
  | "hostStart"
  | "hostAdd"
  | "hostSet"
  | "hostRemove"
  | "hostTest"
  | "hostInstall"
  | "hostInstallCancel"
  | "hostTerminal"
  | "hostInstalling"
  | "hostStop"
  | "sshSuggestions"
>

/**
 * Main's answers to the page's channels of the machines. `latency` is
 * for tests only: how many ms late the page hears what an engine says, as
 * from a host far away (`Address.latency`); 0 is none.
 */
export function machinesAnswers(latency: number) {
  /** An engine's address, with the tests' latency. */
  const late = <A extends { url: string }, E, R>(
    address: Effect.Effect<A, E, R>
  ) => (latency ? Effect.map(address, (at) => ({ ...at, latency })) : address)
  return {
    // Stopped, not by Quit Banda, it says so: the page's Panes do too.
    engine: [none, () => OwnEngine.use((engine) => late(engine.reached))],
    // The other machines' engines, through ssh (hosts.ts, ADR 0081), as
    // far as this one's in a test.
    hosts: { current: [none, () => Hosts.use((hosts) => hosts.current)] },
    hostEngine: [
      text,
      ([name]) => Hosts.use((hosts) => late(hosts.address(name))),
    ],
    sign: [text, ([message]) => signedHello(message)],
    // No name is this machine's own engine, stopped (ADR 0124).
    hostStart: [
      text,
      ([name]) =>
        name === ""
          ? OwnEngine.use((engine) => engine.start)
          : Hosts.use((hosts) => hosts.start(name)),
    ],
    hostAdd: [
      Schema.Tuple([
        Schema.Struct({
          name: Schema.optionalKey(Schema.String),
          ssh: Schema.String,
          banda: Schema.optionalKey(Schema.String),
        }),
      ]),
      ([machine]) => Hosts.use((hosts) => hosts.add(machine)),
    ],
    hostSet: [
      Schema.Tuple([
        Schema.String,
        Schema.Struct({
          ssh: Schema.optionalKey(Schema.String),
          banda: Schema.optionalKey(Schema.String),
        }),
      ]),
      ([name, change]) => Hosts.use((hosts) => hosts.set(name, change)),
    ],
    hostRemove: [text, ([name]) => Hosts.use((hosts) => hosts.remove(name))],
    hostTest: [
      Schema.Tuple([Schema.String, Schema.NullOr(Schema.String)]),
      // An empty `banda` is none, as Add's.
      ([ssh, banda]) =>
        Hosts.use((hosts) => hosts.test(ssh, banda || undefined)),
    ],
    hostInstall: [
      text,
      ([ssh], event) =>
        Hosts.use((hosts) =>
          hosts.install(ssh, (line) =>
            tellPage(event.sender, BRIDGE.hostInstalling.listen, {
              ssh,
              line,
            })
          )
        ),
    ],
    hostInstallCancel: [
      text,
      ([ssh]) => Hosts.use((hosts) => hosts.cancelInstall(ssh)),
    ],
    hostTerminal: [
      Schema.Tuple([Schema.String, Schema.String]),
      ([ssh, remote]) => Effect.sync(() => terminalArgs(ssh, remote)),
    ],
    // Its lines go to the page that asked, as they come.
    hostInstalling: {},
    hostStop: [
      Schema.Tuple([Schema.String, Schema.Boolean]),
      ([name, force]) => Hosts.use((hosts) => hosts.stop(name, force)),
    ],
    sshSuggestions: [none, () => Hosts.use((hosts) => hosts.suggestions)],
  } satisfies Answers<Machines, OwnEngine | Hosts>
}
