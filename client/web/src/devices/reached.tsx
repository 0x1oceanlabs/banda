/**
 * The machines a window reaches, as its devices' parts name them, and a
 * device's kind as a picture.
 */
import { useContext, useMemo } from "react"
import type { Engine } from "@banda/contract"
import type { DeviceKind } from "@banda/contract/devices"
import { THIS_COMPUTER } from "@banda/ui/lib/outside"
import {
  HostsContext,
  sameEach,
  type Shown,
  useHereNamed,
  useHostsBy,
} from "@banda/core/react"
import {
  GlobeIcon,
  type LucideIcon,
  MonitorIcon,
  SmartphoneIcon,
  TerminalIcon,
} from "lucide-react"
import type { Reached } from "./asking"

export const KIND_ICONS: Record<DeviceKind, LucideIcon> = {
  desktop: MonitorIcon,
  browser: GlobeIcon,
  phone: SmartphoneIcon,
  cli: TerminalIcon,
}

/** The machines the window reaches now, this one first. Made again
 * only as one comes or goes, or is named anew, so each door is heard
 * once. */
export function useReached(engine: Engine): readonly Reached[] {
  const hosts = useContext(HostsContext)
  const here = useHereNamed()?.name ?? THIS_COMPUTER
  const live = useHostsBy(liveNamed, sameEach)
  return useMemo(
    () => [
      { engine, name: here },
      ...live.map((one) => {
        const [key, name] = one.split("\n") as [string, string]
        return { engine: hosts.engine(key), name }
      }),
    ],
    [engine, hosts, here, live]
  )
}

/** Each live host's key and the name the window shows it by, as one
 * word a store compares. */
const liveNamed = (hosts: readonly Shown[]): string[] =>
  hosts
    .filter((one) => one.state.state === "live")
    .map((one) => `${one.name}\n${one.named?.name ?? one.name}`)
