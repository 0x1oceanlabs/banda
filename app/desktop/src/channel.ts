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
  return folder("BANDA_STATE", "XDG_STATE_HOME", "state", appData)
}

/**
 * The engine's data folder, where the window keeps its copy of `banda`
 * too (`engine/`, program.ts): `BANDA_DATA`, or the system's data folder
 * as the engine finds it, with this Banda's folder in it.
 */
export function dataFolder(appData: string): string {
  return folder("BANDA_DATA", "XDG_DATA_HOME", "share", appData)
}

/** The folder `named` names, or this Banda's in the system's: on macOS in
 * `appData`, elsewhere in `xdg`'s, or `~/.local/<local>`. */
function folder(
  named: string,
  xdg: string,
  local: string,
  appData: string
): string {
  const set = process.env[named]
  if (set) return set
  const system = process.env[xdg]
  const base =
    process.platform === "darwin"
      ? appData
      : system && isAbsolute(system)
        ? system
        : join(homedir(), ".local", local)
  return join(base, channel.folder)
}
