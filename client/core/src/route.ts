/**
 * The one router for acts (ADR 0106, law 3): where an act runs, by whose
 * its values are, for every Pane, key, menu and Widget alike, so an
 * action does the same from each. It replaces the sets of actions a Pane
 * on another host could run, and the silent drop of the rest: an act
 * runs where its values live, or says why not.
 *
 * Its four owners are a Project, whose machine runs what acts on it; a
 * machine's own thing, by its Host scope's ID, as Settings for arc; the
 * device, as its browser's pages and its disk; and the window, as the
 * arrangement, whatever machine the Panes it moves are on. The window
 * says what it knows of each act's App (`Act`); the router places the
 * values by the Window's hosts (`KeptHosts`), and never runs on this
 * machine what belongs to another.
 */
import type { ProjectId } from "@banda/contract"
import type { Cap } from "./device"
import { type KeptHosts, namedIn } from "./hosts"
import { paneHost, type PaneState } from "./pane"
import type { Args } from "./run"

/**
 * Whose an act's values are (ADR 0106, law 3): a Project's, whose machine
 * is the one that has it, as `pane`'s args may say until the directory
 * does (1a″); a machine's own, by its Host scope's ID; the device's; or
 * the window's.
 */
export type Owner =
  | { project: ProjectId; pane?: Pick<PaneState, "args"> }
  | { machine: ProjectId }
  | "device"
  | "window"

/**
 * An act as the router weighs it: what the window knows of it and of its
 * App. Where it runs:
 *
 * - `owner`: on the machine its values are on, as an App's with an engine
 *   part, there while that machine's welcome lists the App (`app`);
 * - `device`: on this device, as the browser's pages and this device's
 *   disk, which another machine's values never reach;
 * - `window`: in this window, whatever machine its values are on, as the
 *   arrangement's: what it does to a Project it does through that
 *   Project's session.
 */
export type Act = {
  /** Its words, as a toast names what does not run: "Open in a browser". */
  title: string
  at: "owner" | "device" | "window"
  /** Its App, whose engine part runs it on the owner's machine. */
  app?: string
  /** Where its args name no Project, it acts in the one the Person is in
   * (ADR 0087, decision 4), as an App's acts do. */
  here?: true
}

/**
 * Where an act is asked from: a Pane, whose values are its owner's alone,
 * so a Project of another machine it names is refused; or the Person's
 * key, menu or Widget, where Here is, whose args name any Project, and
 * whose Project, where they name none, is Here's.
 */
export type From = { pane: Owner } | { here: Owner }

/** What the router says of an act: it runs, with its args as they go,
 * on host `host` or on this machine; or it does not, and why, in the
 * Person's words, short (`why`) and as a toast says it (`said`). */
export type Route =
  | { runs: true; args: Args | undefined; host?: string }
  | { runs: false; why: string; said: string }

/** What the router reads of the Window's hosts. */
export type Hosts = Pick<
  KeptHosts,
  "get" | "hostOf" | "seen" | "machines" | "modulesOf"
>

/** Where an owner's values are: this machine, a host by its key, or
 * nowhere the Window reaches, in words. */
type Where = { here: true } | { host: string } | { nowhere: string }

/**
 * Where `owner`'s values are, as the Window's hosts place them: a Project
 * on the machine that has it (`KeptHosts.hostOf`, its pane's args naming
 * the host until the directory does); a machine by its Host scope's ID,
 * among those the Window shows; none for the device's and the window's.
 * A machine the Window does not show is nowhere: an act on it fails
 * closed, never on this machine.
 */
function whereOf(hosts: Hosts, owner: Owner): Where | undefined {
  if (owner === "device" || owner === "window") return undefined
  if ("machine" in owner) {
    const machine = hosts.machines
      .get()
      .find((one) => one.machine === owner.machine)
    if (!machine) return { nowhere: "This window does not reach that machine" }
    return machine.host === undefined ? { here: true } : { host: machine.host }
  }
  const host = hosts.hostOf(owner.project, owner.pane && paneHost(owner.pane))
  return host === undefined ? { here: true } : { host }
}

const sameWhere = (a: Where, b: Where) =>
  "here" in a
    ? "here" in b
    : "host" in a
      ? "host" in b && a.host === b.host
      : false

/** Host `host`'s name, as the Window shows it or this device last saw it. */
const nameOf = (hosts: Hosts, host: string) =>
  namedIn(hosts.get(), host, hosts.seen).name

const refused = (why: string, said = why): Route => ({
  runs: false,
  why,
  said,
})

/**
 * Where `act`, asked `from` a Pane or where the Person is, runs with
 * `args` (ADR 0106, law 3):
 *
 * - A Project its args name is its owner; else, asked from a Pane, the
 *   Pane's owner, whose Project goes into its args, so what runs it acts
 *   on the Pane's; else, for an App's act, Here's; else none, as an act
 *   of the window or the device that takes no Project's values.
 * - A Pane's values are its owner's: a Project of another machine it
 *   names is refused, as values of two machines are, never sent to that
 *   machine in the Pane's place.
 * - The window's own acts run, whatever their owner.
 * - On this machine, every act runs, as before.
 * - On a host the Window does not know, none runs: it fails closed.
 * - On another machine, the device's acts do not run, nor an App's that
 *   machine's welcome does not list: "Not on arc yet: Open in a browser".
 *   An App's act there runs, while that machine is away too: its own acts
 *   fail at once then, in the words of its pill (ADR 0106, law 4), as a
 *   Pane it opens shows that pill.
 */
export function routeAct(
  hosts: Hosts,
  act: Act,
  from: From,
  args?: Args
): Route {
  const pane = "pane" in from ? from.pane : undefined
  const asked =
    typeof args?.project === "string" ? (args.project as ProjectId) : undefined
  let owner: Owner | undefined
  let runWith = args
  if (asked !== undefined) {
    // The Pane's own Project, and Here's as a Pane's act comes again
    // through the window's run from the Pane in focus, is placed first by
    // the host it is on; so is one no machine lists that a Pane names, as
    // its host has not listed it yet, which goes there, never to this
    // machine. One another machine lists is placed by that listing, so a
    // Pane never lends its host to a third machine's Project.
    const by = "pane" in from ? from.pane : from.here
    const hint =
      typeof by === "object" &&
      "project" in by &&
      (by.project === asked ||
        (pane !== undefined && hosts.hostOf(asked, undefined) === undefined))
        ? by.pane && paneHost(by.pane)
        : undefined
    const host = typeof args?.host === "string" ? args.host : hint
    owner = { project: asked, pane: { args: host ? { host } : {} } }
    // A Pane of the window's or the device's, as the Sheet's, holds no
    // machine's values, so the Project it names is placed alone.
    const its = pane !== undefined ? whereOf(hosts, pane) : undefined
    if (its !== undefined) {
      if ("nowhere" in its) return refused(its.nowhere)
      if (!sameWhere(whereOf(hosts, owner)!, its)) {
        const name = "host" in its ? nameOf(hosts, its.host) : "this machine"
        return refused(`That is not on ${name}`)
      }
    }
  } else if (act.at !== "window") {
    owner = pane ?? (act.here && "here" in from ? from.here : undefined)
    if (pane !== undefined && typeof pane === "object" && "project" in pane)
      runWith = { ...args, project: pane.project }
  }
  if (act.at === "window" || owner === undefined)
    return { runs: true, args: runWith }
  const where = whereOf(hosts, owner)
  if (where === undefined || "here" in where)
    return { runs: true, args: runWith }
  if ("nowhere" in where) return refused(where.nowhere)
  const { host } = where
  const shown = hosts.get().find((one) => one.name === host)
  if (!shown)
    return refused(`This window does not reach ${nameOf(hosts, host)}`)
  const modules = hosts.modulesOf(host)
  if (
    act.at === "device" ||
    (act.app !== undefined && modules && !modules.includes(act.app))
  ) {
    const why = `Not on ${nameOf(hosts, host)} yet`
    return refused(why, `${why}: ${act.title}`)
  }
  return { runs: true, args: runWith, host }
}

/**
 * The device as a Pane holds it (ADR 0106, law 1 and law 6): what it can
 * do, by the closed list of capabilities (ADR 0082, decision 12), and
 * whether a file of a Project is one of this computer's, its path here
 * if it is. Thin in stage 2: a Pane asks it, never where it is.
 */
export type Device = {
  has: (cap: Cap) => boolean
  local: (file: { project: ProjectId; path: string }) => string | undefined
}

/**
 * The device for a Pane whose owner is `owner`, as `has` says what this
 * device can do: a file is this computer's where its Project is this
 * machine's, placed as the Pane's own is.
 */
export function deviceFor(
  hosts: Hosts,
  owner: Owner,
  has: (cap: Cap) => boolean
): Device {
  const hint =
    typeof owner === "object" && "project" in owner ? owner.pane : undefined
  return {
    has,
    local: (file) => {
      const where = whereOf(hosts, { project: file.project, pane: hint })
      return where && "here" in where ? file.path : undefined
    },
  }
}
