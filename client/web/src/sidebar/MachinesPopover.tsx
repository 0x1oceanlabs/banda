/**
 * The machines in the sidebar's foot (ADR 0098, decisions 18 and 21): a
 * dot for each, this machine first, green while the Window reaches it,
 * grey while it does not; a click lists them, each with how it stands,
 * its battery and whether it stays awake (ADR 0097), as its card says
 * them (`MachineCard`), Start where Banda is stopped there, and
 * Machines…, which opens their settings. Only with another machine in
 * `hosts.toml`: one alone has nothing to tell apart.
 */
import { type ReactNode, useCallback } from "react"
import type { Named } from "@banda/contract/machines"
import { Button } from "@banda/ui/components/button"
import { MachineMark } from "@banda/ui/components/machine-icon"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { Separator } from "@banda/ui/components/separator"
import { cn } from "@banda/ui/lib/utils"
import {
  awakeWords,
  notAnswered,
  otherBuild,
  type Shown,
  useHereNamed,
  useHosts,
  useNowOf,
} from "@banda/core/react"
import { SettingsIcon } from "lucide-react"
import { useOpenUpdates } from "../bar/heard"
import { useTurnsOn } from "../calls/battery"
import {
  footWords,
  type Standing,
  standingOf,
  THIS_MACHINE,
} from "../machines/words"
import { StartThere } from "./HostPart"
import { BatteryFact } from "./MachineCard"
import { useOpen } from "./open"

/** Each dot's colour, by how its machine stands: out of reach it greys,
 * and only a sign-in or a refusal takes a call's colour. */
const DOT: Readonly<Record<Standing, string>> = {
  live: "bg-added",
  away: "bg-muted-foreground/50",
  asks: "bg-attention",
  refused: "bg-destructive",
}

/** What this machine says after its name. */
const HERE = "this"

export function MachinesPopover() {
  const hosts = useHosts()
  const here = useHereNamed() ?? THIS_MACHINE
  const open = useOpen()
  // How each stands, by the Window's one clock while one is away, drawn
  // again only as the words change: "live", "away 12m".
  const said = useNowOf(
    useCallback(
      (now: number) => hosts.map((host) => footWords(host, now)).join("\n"),
      [hosts]
    ),
    hosts.some((host) => host.away !== undefined)
  )
  if (hosts.length === 0) return null
  const words = said.split("\n")
  const named = [
    `${here.name}, ${HERE}`,
    ...hosts.map((host, at) => `${host.named.name}, ${words[at]}`),
  ].join("; ")
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Machines: ${named}`}
            title="Machines"
            className="ml-auto h-7 min-w-0 gap-2.5 px-2 text-meta font-normal text-muted-foreground"
          />
        }
      >
        <Dot named={here} standing="live" words={HERE} />
        {hosts.map((host, at) => (
          <Dot
            key={host.name}
            named={host.named}
            standing={standingOf(host.state)}
            words={words[at]!}
            host={host.name}
          />
        ))}
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72 gap-0.5 p-2">
        <PopoverTitle className="sr-only">Machines</PopoverTitle>
        <Row named={here} standing="live" words={HERE} />
        {hosts.map((host, at) => (
          <HostRow key={host.name} host={host} words={words[at]!} />
        ))}
        <Separator className="my-1" />
        <PopoverClose
          className="flex h-8 items-center gap-2 rounded-control px-1 text-left text-meta outline-none hover:bg-accent focus-visible:bg-accent [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
          onClick={() => open("settings.open", { link: "machines" })}
        >
          <SettingsIcon />
          Machines…
        </PopoverClose>
      </PopoverContent>
    </Popover>
  )
}

/** A machine in the foot: its dot and its name, how it stands in its
 * tooltip; a screen reader hears them all in the button's name. */
function Dot({
  named,
  standing,
  words,
  host,
}: {
  named: Named
  standing: Standing
  words: string
  /** Its key in `hosts.toml`; none for this machine. */
  host?: string
}) {
  return (
    <span
      aria-hidden
      data-machine-dot={host ?? HERE}
      data-standing={standing}
      title={`${named.name} · ${words}`}
      className="flex min-w-0 items-center gap-1.5"
    >
      <Light standing={standing} />
      <span className="truncate">{named.name}</span>
    </span>
  )
}

/** A dot, its colour easing as its machine goes and comes back. */
function Light({ standing }: { standing: Standing }) {
  return (
    <i
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full transition-colors duration-(--dur-slow) ease-(--ease)",
        DOT[standing]
      )}
    />
  )
}

function HostRow({ host, words }: { host: Shown; words: string }) {
  const { name, named, state, power } = host
  const turns = useTurnsOn(name)
  const openUpdates = useOpenUpdates()
  return (
    <Row
      named={named}
      standing={standingOf(state)}
      host={name}
      words={
        state.state === "signin" ? (
          // A link opens in the system's browser, as every link of the page.
          <a
            href={state.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-ring underline-offset-3 hover:underline"
          >
            Sign in to Tailscale
          </a>
        ) : otherBuild(state) ? (
          // Another build opens its updates, as on its label (ADR 0115).
          <PopoverClose
            className="hover:text-foreground"
            onClick={() => openUpdates(name)}
          >
            {words}
          </PopoverClose>
        ) : (
          words
        )
      }
      why={whyOf(host)}
      start={state.state === "stopped" ? host : undefined}
    >
      {/* Its battery and why it is awake, while it is live: away, the last
          heard is no longer true. */}
      {state.state === "live" && power && (
        <>
          {power.battery && <BatteryFact battery={power.battery} />}
          <span>{awakeWords(power.awake, turns).short}</span>
        </>
      )}
    </Row>
  )
}

/** Why a machine stands as it does, in its words' tooltip: its builds
 * beside this window's, the link ended, it has not answered since 14:02,
 * or why Banda there refused. */
function whyOf({ state, stale, named, asOf }: Shown): string | undefined {
  switch (state.state) {
    case "live": {
      const other = otherBuild(state)
      return other && `${other}: ${named.name}'s updates`
    }
    case "away":
      return stale ? notAnswered(named, asOf) : state.why
    case "refused":
      return state.why
    case "stopped":
      return `Banda is stopped on ${named.name}`
    default:
      return undefined
  }
}

/** A machine in the popover: its dot, its icon and name, how it stands,
 * and its facts below. */
function Row({
  named,
  standing,
  words,
  why,
  host,
  start,
  children,
}: {
  named: Named
  standing: Standing
  words: ReactNode
  why?: string
  host?: string
  /** It is stopped: Start starts Banda there. */
  start?: Shown
  children?: ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={named.name}
      data-machine={host ?? HERE}
      className="flex flex-col gap-0.5 px-1 py-1"
    >
      <div className="flex min-h-6 items-center gap-2">
        <Light standing={standing} />
        <MachineMark
          named={named}
          form="full"
          className="min-w-0 font-medium text-foreground [&_svg]:text-muted-foreground"
        />
        <span
          title={why}
          data-machine-words=""
          className="ml-auto min-w-0 truncate text-meta text-muted-foreground tabular-nums"
        >
          {words}
        </span>
        {start && <StartThere host={start} />}
      </div>
      {children && (
        <div className="flex flex-col gap-0.5 pl-3.5 text-meta text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  )
}
