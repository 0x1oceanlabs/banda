/**
 * Which Banda this is (ADR 0033, decision 1): Banda, Banda Dev, or one
 * run from a checkout. build.mjs fixes it from `BANDA_CHANNEL` when it
 * bundles main, as engine/build.rs fixes the engine's: both name the same
 * folder, which is the window's class too.
 */
import { homedir } from "node:os"
import { posix, win32 } from "node:path"

/** What Banda says it is, where an app is listed. */
export const DESCRIPTION = "A tiling workspace for working with Agents"

/** Where Banda's releases are, as GitHub names the repository. */
export const REPOSITORY = { owner: "0x1oceanlabs", repo: "banda" } as const

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

/** What Banda's places are found from: this system, or a test's. */
export type System = {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  home: string
  /** Electron's folder for apps' data, which `dirs` takes on macOS. */
  appData: string
}

const system = (appData: string): System => ({
  platform: process.platform,
  env: process.env,
  home: homedir(),
  appData,
})

/**
 * The engine's state folder, where the window keeps its profile too
 * (`window/`): `BANDA_STATE`, or the system's state folder as the engine
 * finds it (`dirs`, engine/src/places.rs) with this Banda's folder in it.
 */
export function stateFolder(appData: string): string {
  return folderOf("state", system(appData))
}

/**
 * The engine's data folder, where the window keeps its copy of `banda`
 * too (`engine/`, program.ts): `BANDA_DATA`, or the system's data folder
 * as the engine finds it, with this Banda's folder in it.
 */
export function dataFolder(appData: string): string {
  return folderOf("data", system(appData))
}

/**
 * The engine's config folder, where the window reads `hosts.toml` too
 * (hosts.ts): `BANDA_CONFIG`, or the system's config folder as the
 * engine finds it, with this Banda's folder in it.
 */
export function configFolder(appData: string): string {
  return folderOf("config", system(appData))
}

/** The variable that moves each place, and its XDG folder and the one
 * in home that holds it when none is set. */
const PLACES = {
  state: { named: "BANDA_STATE", xdg: "XDG_STATE_HOME", home: ".local/state" },
  data: { named: "BANDA_DATA", xdg: "XDG_DATA_HOME", home: ".local/share" },
  config: { named: "BANDA_CONFIG", xdg: "XDG_CONFIG_HOME", home: ".config" },
} as const

/**
 * The place `name` on `on`, as the engine finds it: its variable's, or
 * this Banda's `folder` in the system's. On Windows that is
 * `%LOCALAPPDATA%\<folder>\<name>`, all of Banda's under one folder and
 * none in Roaming (ADR 0090, decision 3); on macOS in `appData`; elsewhere
 * in XDG's folder, or the one in home.
 */
export function folderOf(
  name: keyof typeof PLACES,
  on: System,
  folder: string = channel.folder
): string {
  const { named, xdg, home } = PLACES[name]
  const set = on.env[named]
  if (set) return set
  if (on.platform === "win32") {
    const base = on.env.LOCALAPPDATA || win32.join(on.home, "AppData", "Local")
    return win32.join(base, folder, name)
  }
  const xdgFolder = on.env[xdg]
  const base =
    on.platform === "darwin"
      ? on.appData
      : xdgFolder && posix.isAbsolute(xdgFolder)
        ? xdgFolder
        : posix.join(on.home, home)
  return posix.join(base, folder)
}
