/**
 * How every host of Panes mounts one (ADR 0106, decision 1): the Frame in
 * the Strip, the drawer and a popped-out window, the floating tile of
 * Quick Look and the Sheet, and the sign-in dialog of Settings' Agents.
 * Each gives its Pane the same handles: its owner's session, the window's
 * acts through the one router (law 3), what can run from it (law 6), and
 * the device (law 1).
 */
import {
  Component,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import type { Engine, ProjectId } from "@banda/contract"
import {
  type Act,
  type Cap,
  deviceFor,
  type From,
  type Hosts,
  type KeptHosts,
  type Owner,
  type Route,
  routeAct,
  UNKNOWN,
} from "@banda/core"
import { HostsContext } from "@banda/core/react"
import { Button } from "@banda/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
} from "@banda/ui/components/empty"
import { toast } from "@banda/ui/components/sonner"
import { projectsChanged } from "@banda/ui/lib/projects"
import type { AnyPaneKind, Args } from "@banda/ui/module"
import type { PaneProps, PaneState, Runs } from "@banda/ui/pane"
import { KindsContext } from "../launcher"
import { KINDS, kindAct, kindOf, kindRuns, showsOf } from "../registry"

/** What a Pane's host hands it to act on its place. */
export type Handle = Pick<
  PaneProps<Args>,
  "open" | "update" | "close" | "label" | "composer"
>

/** What a Pane runs, asks and holds of the device, as `handlesOf` gives
 * it. */
export type Handles = Pick<PaneProps<Args>, "run" | "runs" | "device">

/** One of the window's acts as the router weighs it (`Act`), and whether
 * it takes the arg `name`, as its schema says. */
export type Weighed = Act & { takes: (name: string) => boolean }

/**
 * What the window tells its Panes' hosts, which the Tiling does not import
 * (ADR 0087, decision 5): each of its acts by its id, as the router weighs
 * it, none for one it lacks; and what this device can do. Outside a
 * window, as in a test of a part, no act is known and the device can do
 * nothing.
 */
export type Routing = {
  act: (id: string) => Weighed | undefined
  has: (cap: Cap) => boolean
}

export const RoutingContext = createContext<Routing>({
  act: () => undefined,
  has: () => false,
})

/** Says why an act did not run, in a toast, once while it shows: "Not on
 * arc yet: Open in a browser" (ADR 0106, law 3). */
export function refused(said: string): void {
  toast(said, { id: `refused ${said}` })
}

/**
 * Runs an act as `route` says, or says why not (ADR 0106, law 3). A
 * Project no machine the Window knows has may be this machine's, added
 * since its list was read: that list is read once more, from this
 * machine's own engine, before the act is refused, so nothing fails closed
 * only because this window has not looked.
 */
export function actAs(
  hosts: Pick<KeptHosts, "reread">,
  route: () => Route,
  run: (args: Args | undefined) => void
): void {
  const first = route()
  if (first.runs) return run(first.args)
  if (first.why !== UNKNOWN) return refused(first.said)
  void hosts.reread().then(() => {
    const again = route()
    if (!again.runs) return refused(again.said)
    // The rest of the window hears of the Project too.
    projectsChanged()
    run(again.args)
  })
}

/**
 * The handles of a Pane whose values are `owner`'s, `pane` of it where it
 * is a Pane of a Project, as the Window's `hosts` place them and its
 * `routing` weighs its acts (ADR 0106, laws 1, 3 and 6):
 *
 * - `run` goes through the router from the Pane: what does not run says
 *   why in a toast, and what does goes to the window's `run` with the
 *   Pane's Project, and the Item it shows for an act that takes one,
 *   where its args name none, so it acts on the Pane's own, not on the
 *   one in focus. One the window lacks goes to its `run`, which says so;
 * - `runs` asks the router whether an action, or a Pane it opens, runs
 *   from it;
 * - `device` is this device, which can do what `routing` says.
 */
export function handlesOf(
  hosts: Hosts & Pick<KeptHosts, "reread">,
  routing: Routing,
  owner: Owner,
  run: ((action: string, args?: Args) => void) | undefined,
  pane: PaneState | undefined
): Handles {
  const from: From = { pane: owner }
  const project =
    typeof owner === "object" && "project" in owner ? owner.project : undefined
  const subject = pane && showsOf(pane)
  const routed =
    run &&
    ((action: string, args?: Args) => {
      const act = routing.act(action)
      if (!act) return run(action, args)
      const own = { ...args }
      if (
        project !== undefined &&
        own.project === undefined &&
        act.takes("project")
      )
        own.project = project
      if (subject && own.item === undefined && act.takes("item"))
        own.item = subject
      actAs(
        hosts,
        () => routeAct(hosts, act, from, own),
        (args) => run(action, args)
      )
    })
  const runs: NonNullable<Handles["runs"]> = (what, args) => {
    const act = typeof what === "string" ? routing.act(what) : kindAct(what)
    if (!act) return { runs: false, why: "This window does not know it" }
    const route = routeAct(hosts, act, from, args)
    return route.runs ? { runs: true } : { runs: false, why: route.why }
  }
  return { run: routed, runs, device: deviceFor(hosts, routing.has) }
}

/** The handles of a Pane whose values are `owner`'s (`handlesOf`): the
 * same functions while what they are made of stays, so a Pane that takes
 * them is not drawn again. */
export function usePaneHandles(
  owner: Owner,
  run: ((action: string, args?: Args) => void) | undefined,
  pane?: PaneState
): Handles {
  const hosts = useContext(HostsContext)
  const routing = useContext(RoutingContext)
  return useMemo(
    () => handlesOf(hosts, routing, owner, run, pane),
    [hosts, routing, owner, run, pane]
  )
}

/**
 * Draws again as `engine`'s welcome lists other Apps, so what asks the
 * router whether a kind opens on its owner, as the Frame's gate does,
 * follows that machine's; none for no engine.
 */
export function useWelcome(engine: Engine | undefined): void {
  const [, setModules] = useState("")
  useEffect(
    () =>
      engine?.watch((status) => {
        if (status.state === "open") setModules(status.modules.join())
      }),
    [engine]
  )
}

/** What a host shows of its Pane: the Pane, as its kind; or why not. */
export type Gate = { opens: AnyPaneKind } | { why: string }

/**
 * What a host shows of `pane` (ADR 0106, decision 2): the Pane where its
 * kind opens from its owner; else why not. On another machine the router
 * says (`runs`), by that machine's Apps as its welcome lists them, never
 * this window's: a kind that does not say `elsewhere`, or whose App that
 * machine's build lacks, is "Not on arc yet". On this machine, the Pane
 * shows while its engine runs the kind's module (`modules`).
 */
export function gateOf(
  pane: PaneState,
  runs: ((pane: PaneState) => Runs) | undefined,
  modules: readonly string[]
): Gate {
  const kind = kindOf(pane.kind)
  if (!kind) return { why: "This window does not know this kind of Pane." }
  if (runs) {
    const opens = runs(pane)
    return opens.runs ? { opens: kind } : { why: opens.why }
  }
  return kindRuns(kind.kind, modules)
    ? { opens: kind }
    : { why: "This Pane comes back when the engine runs its module." }
}

/**
 * Pane `pane` of kind `kind`, mounted as every host mounts one: on its
 * owner's session `engine`, in `project`, with its host's `handle`, and
 * what it runs, asks and holds of the device made here
 * (`usePaneHandles`), and the kinds of Pane the window knows, which New
 * Pane offers (`KindsContext`). One that breaks says so in its place,
 * and can be closed: the other Panes and the window go on.
 */
export function PaneMount({
  kind,
  engine,
  project,
  pane,
  owner,
  focused,
  selected,
  peek,
  handle,
  run,
}: {
  kind: AnyPaneKind
  engine: Engine
  project: ProjectId
  pane: PaneState
  owner: Owner
  focused: boolean
  selected?: boolean
  peek?: boolean
  handle: Handle
  run: ((action: string, args?: Args) => void) | undefined
}) {
  const handles = usePaneHandles(owner, run, pane)
  return (
    <Broken close={handle.close}>
      <KindsContext value={KINDS}>
        <kind.Pane
          engine={engine}
          project={project}
          args={pane.args}
          focused={focused}
          selected={selected}
          {...(peek && { peek })}
          {...handle}
          {...handles}
        />
      </KindsContext>
    </Broken>
  )
}

/**
 * A Pane that broke, as on args its kind cannot read, says so in its tile
 * and can be closed: the other Panes and the window go on.
 */
export class Broken extends Component<
  { close: () => void; children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Empty className="h-full">
        <EmptyDescription>
          This Pane could not show what it keeps.
        </EmptyDescription>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={this.props.close}>
            Close it
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
}
