/**
 * Which Banda this is (ADR 0033, decision 1): Banda, Banda Dev, or one
 * run from a checkout. build.mjs fixes it from `BANDA_CHANNEL` when it
 * bundles main, as engine/build.rs fixes the engine's: both name the same
 * folder, which is the window's class too.
 */
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

/** What Banda says it is, where an app is listed. */
export const DESCRIPTION = "A tiling workspace for working with Agents"

/**
 * Each channel's name, folder, app ID and icon (build.mjs,
 * electron-builder.config.mjs).
 */
export const CHANNELS = {
  stable: {
    name: "Banda",
    folder: "banda",
    appId: "so.banda.app",
    icon: "icons/banda.png",
  },
  dev: {
    name: "Banda Dev",
    folder: "banda-dev",
    appId: "so.banda.dev",
    icon: "icons/banda-dev.png",
  },
  local: {
    name: "Banda Local",
    folder: "banda-local",
    appId: "so.banda.local",
    icon: "icons/banda-dev.png",
  },
} as const

export const channel =
  CHANNELS[(process.env.BANDA_CHANNEL ?? "local") as keyof typeof CHANNELS]

/**
 * The engine's state folder, where the window keeps its profile too
 * (`window/`): `BANDA_STATE`, or the system's state folder as the engine
 * finds it (`dirs`, engine/src/places.rs) with this Banda's folder in it.
 * `appData` is Electron's, which `dirs` takes on macOS.
 */
export function stateFolder(appData: string): string {
  if (process.env.BANDA_STATE) return process.env.BANDA_STATE
  const xdg = process.env.XDG_STATE_HOME
  const base =
    process.platform === "darwin"
      ? appData
      : xdg && isAbsolute(xdg)
        ? xdg
        : join(homedir(), ".local", "state")
  return join(base, channel.folder)
}
