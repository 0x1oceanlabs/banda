import { useEffect, useMemo, useState } from "react"
import type { Engine, Fence, ProjectId, Status } from "@banda/contract"
import {
  MACHINE_NAMED,
  type MachineIcon,
  type Named,
} from "@banda/contract/machines"
import { kept } from "../lib/kept"

/** The engine connection's status, kept current. */
export function useStatus(engine: Engine): Status {
  const [status, setStatus] = useState(engine.status)
  useEffect(() => engine.watch(setStatus), [engine])
  return status
}

/**
 * The modules the engine ran when it last answered. A connection that
 * breaks for a moment keeps them, so the Panes on the workspaces stay as they
 * are and follow on when it comes back.
 */
export function useModules(engine: Engine): readonly string[] {
  const [modules, setModules] = useState<readonly string[]>([])
  useEffect(
    () =>
      engine.watch((status) => {
        if (status.state !== "open") return
        setModules((was) =>
          was.join() === status.modules.join() ? was : status.modules
        )
      }),
    [engine]
  )
  return modules
}

/**
 * The ID this machine's modules are followed by, from when the engine
 * first named it; a connection that breaks keeps it, as the modules.
 */
export function useMachine(engine: Engine): ProjectId | undefined {
  const [machine, setMachine] = useState<ProjectId>()
  useEffect(
    () =>
      engine.watch((status) => {
        if (status.state === "open" && status.machine) {
          setMachine(status.machine)
        }
      }),
    [engine]
  )
  return machine
}

/** The ten icons a machine takes (ADR 0095, decision 1): the compiler
 * says when the contract gains one this leaves out. */
const ICONS: Readonly<Record<MachineIcon, true>> = {
  laptop: true,
  desktop: true,
  tower: true,
  server: true,
  database: true,
  storage: true,
  router: true,
  vm: true,
  phone: true,
  tablet: true,
}

const isIcon = (icon: unknown): icon is MachineIcon =>
  typeof icon === "string" && Object.hasOwn(ICONS, icon)

/** The most characters a machine's name shows. */
const NAME_MOST = 16

/**
 * Text a machine says of itself, as the page draws it (ADR 0095, decision
 * 2): control and format characters (bidi controls, zero-width spaces and
 * joiners) and line and paragraph separators go, and it is cut at `most`
 * characters; empty where it is no text.
 */
export function cleanText(said: unknown, most: number): string {
  return typeof said === "string"
    ? [...said.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")]
        .slice(0, most)
        .join("")
        .trim()
    : ""
}

/**
 * What another machine said it is called and drawn by, as the page draws
 * it (ADR 0095, decision 2): the first text a machine writes of itself
 * that the page shows, so it is cleaned before anything draws it
 * (`cleanText`), the name cut at 16 characters. A name left empty is
 * `key`, the machine's key in `hosts.toml`, and an icon not of the ten is
 * `desktop`. Drawn as text, never as markup.
 */
export function cleanNamed(said: unknown, key: string): Named {
  const { name, icon } = (
    typeof said === "object" && said !== null ? said : {}
  ) as { name?: unknown; icon?: unknown }
  return {
    name: cleanText(name, NAME_MOST) || key,
    icon: isIcon(icon) ? icon : "desktop",
  }
}

/** The last name and icon this device saw of each other machine, by its
 * key in `hosts.toml`: the view is each device's (ADR 0081, decision 1). */
const SEEN = kept<Named>(
  "banda.machines.seen",
  (value): value is Named =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as Named).name === "string",
  64
)

/**
 * Machine `key` as this device last saw it, so one away or stopped draws as
 * before; before its first welcome here, its key with the `desktop` icon.
 */
export function seenNamed(key: string): Named {
  return cleanNamed(SEEN.read()[key], key)
}

/**
 * Machine `key` as this device last saw it (`seenNamed`), drawn again as
 * it is seen anew; none for no key, as this machine's own Panes have. It
 * opens no stream: the window follows each machine it reaches
 * (`followNamed`), and this hears what that keeps.
 */
export function useSeenNamed(key: string | undefined): Named | undefined {
  const said = SEEN.use()[key ?? ""]
  return useMemo(
    () => (key === undefined ? undefined : cleanNamed(said, key)),
    [said, key]
  )
}

/**
 * Hands `take` what machine `key`'s `engine` says it is called and drawn
 * by, cleaned: from each welcome, and each piece of `machine.named` as it
 * changes. This device keeps the last (`seenNamed`). Returns how to stop.
 */
export function followNamed(
  engine: Engine,
  key: string,
  take: (named: Named) => void
): () => void {
  return heardNamed(engine, (named) => {
    const now = cleanNamed(named, key)
    const was = SEEN.read()[key]
    if (was?.name !== now.name || was?.icon !== now.icon) SEEN.put(key, now)
    take(now)
  })
}

/** Hands `said` what `engine` says its machine is called and drawn by,
 * as it says it, not yet cleaned: from each welcome, and each piece of
 * `machine.named`. Returns how to stop. */
function heardNamed(engine: Engine, said: (named: unknown) => void) {
  const watching = engine.watch((status) => {
    if (status.state === "open" && status.named) said(status.named)
  })
  // A stream of the machine's that the contract's methods do not list:
  // the kernel's own, as `window.requests` is. An older engine refuses
  // it, and then its welcome alone names it.
  const hear = engine.stream.bind(engine) as unknown as (
    project: undefined,
    method: string,
    params: object,
    onPiece: (piece: unknown) => void,
    onEnd: () => void
  ) => () => void
  const hearing = hear(undefined, MACHINE_NAMED, {}, said, () => undefined)
  return () => {
    watching()
    hearing()
  }
}

/** Forgets the name and icon this device last saw of machine `key`, as
 * it is taken out of `hosts.toml`: added again, it shows as its key until
 * its first welcome, as a machine new here does. */
export function forgetNamed(key: string): void {
  SEEN.drop(key)
}

/**
 * Hands `take` this machine's name and icon, as `engine`, its own, says
 * them in its welcome and on `machine.named` as they change, cleaned as
 * another machine's are. Nothing is kept on the device: this machine is
 * never away from its own window. Returns how to stop.
 */
export function followThisNamed(
  engine: Engine,
  take: (named: Named) => void
): () => void {
  return heardNamed(engine, (said) => take(cleanNamed(said, "")))
}

/** This machine's name and icon (`followThisNamed`); none until its
 * engine first says them. Settings → Machines draws it. */
export function useNamed(engine: Engine): Named | undefined {
  const [named, setNamed] = useState<Named>()
  useEffect(
    () =>
      followThisNamed(engine, (now) =>
        setNamed((was) =>
          was?.name === now.name && was.icon === now.icon ? was : now
        )
      ),
    [engine]
  )
  return named
}

/** The fence of an engine that says none: one from before the fence,
 * which gets it as it starts again. */
const BEFORE_THE_FENCE: Fence = {
  fence: "missing",
  why: "not_built",
  words: "This engine is from before the fence.",
}

/**
 * Whether the fence around the engine's Harnesses holds, as the engine
 * last said (ADR 0083, decision 1): what a new Thread's mode follows. A
 * connection that breaks keeps it; none until the engine first answered.
 */
export function useFence(engine: Engine): Fence | undefined {
  const [fence, setFence] = useState<Fence>()
  useEffect(
    () =>
      engine.watch((status) => {
        if (status.state !== "open") return
        const now = status.fence ?? BEFORE_THE_FENCE
        setFence((was) =>
          JSON.stringify(was) === JSON.stringify(now) ? was : now
        )
      }),
    [engine]
  )
  return fence
}

/**
 * Whether `fence` holds whole, as the engine's `Fence::holds_whole` says:
 * with Landlock's scopes too, and for a user outside the `docker` group.
 * Only there is Full access the default, and an Agent in it not the
 * Person in Banda.
 */
export function holdsWhole(fence: Fence | undefined): boolean {
  return (
    fence?.fence === "holds" &&
    !fence.docker_group &&
    !hasGaps(fence) &&
    !hasLinks(fence)
  )
}

/** Whether some of the settings a fence that holds keeps from Agents are
 * links, which an Agent could point elsewhere: dotfiles kept as links. */
export function hasLinks(fence: Fence & { fence: "holds" }): boolean {
  return (fence.movable?.length ?? 0) > 0
}

/** Whether a fence that holds lacks Landlock's scopes, its second layer:
 * it has gaps. */
export function hasGaps(fence: Fence & { fence: "holds" }): boolean {
  return !fence.layers.includes("landlock")
}
