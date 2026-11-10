/**
 * The words the page and the desktop say to each other (ADR 0089,
 * decision 2): what the bridge's channels carry, which the page's device
 * adapter (`client/web/src/boot/desktop.ts`) and Electron main both read.
 * The channels themselves are the desktop's table (`BRIDGE`, in
 * `client/desktop/src/bridge.ts`). The port's interface (`Device`) joins
 * the core at W1, with its second reader; the device object the Window
 * reaches them by, and its desktop adapter, stay in `client/web/src/boot/`
 * (decision 4).
 */
import type { Named, ProjectId } from "@banda/contract"
import type { PaneState, Place } from "./pane"
import type { Args } from "./run"

/**
 * Where Banda's own update is (ADR 0041, decision 2), as main tells it:
 * nothing to say, a look the Person asked for, a version downloading, one
 * ready to install on quit (or once the Threads stop), one out that the Person installs with
 * `command` (on macOS, through brew: ADR 0033, decision 6), or one that
 * cannot install until the Person mends something. `name` is the app's, `Banda Dev`, and `have` the
 * version that runs. `always` keeps the widget on the bar with nothing to
 * say, as Banda Dev's is (ADR 0045).
 */
export type Update = { name: string; have: string; always: boolean } & (
  | {
      state: "none"
      /** When the last look ended, in ms since the epoch. */
      looked?: number
      /** Why the last look the Person asked for failed. */
      missed?: string
    }
  | { state: "looking" }
  | {
      state: "downloading"
      version: string
      share: number
      notes: Note[]
      /** Banda restarts into it once it is down (`update.now`), and
       * once no Thread works (ADR 0072, decision 3). */
      restarts: boolean
      /** Bytes down, and of how many, when electron-updater says. */
      down?: number
      size?: number
    }
  | {
      state: "ready"
      version: string
      notes: Note[]
      /** Banda waits for the Threads to stop, then restarts into it
       * (ADR 0072, decision 3); the window asks for the restart. */
      waits: boolean
    }
  | {
      /** The first moments of a Banda that restarted into a new version
       * (ADR 0072, decision 4), until the window says it was seen. */
      state: "updated"
      from: string
      notes: Note[]
    }
  | { state: "out"; version: string; notes: Note[]; command: string }
  | { state: "failed"; reason: string }
)

/** What one release since the Person's changed: a Dev's commit title,
 * a Stable's PRs (ADR 0033, decision 4). */
export type Note = { version: string; text: string }

/**
 * Another machine's engine, as the window reaches it over ssh (ADR 0081,
 * decision 4; `hosts.toml`): starting; waiting for the Person to sign in
 * to Tailscale at `url`; live, with its build and this window's own
 * (`own`), which may differ; away, and tried again soon; stopped as asked
 * there, and started again only when the page asks (`hostStart`); or
 * refused, and tried again every ten minutes or when the page asks. `why`
 * is the window's words, never what the other machine said, and names no
 * machine: the page puts the machine's name before it (ADR 0095, decision
 * 2). `name` is its key in `hosts.toml`, this device's own: the name and
 * icon the window draws are what the machine says on its own engine.
 * `ssh` and `banda` are its entry there, as Settings → Machines shows and
 * changes them (`hostSet`).
 */
export type HostState = {
  name: string
  /** Where ssh goes, as `hosts.toml` says it. */
  ssh: string
  /** The `banda` it runs there; none to find this build's own there. */
  banda?: string
} & (
  | { state: "connecting" }
  | { state: "signin"; url: string }
  | {
      state: "live"
      build: string | null
      version: string | null
      own: { build: string | null; version: string | null }
    }
  | { state: "away"; why: string }
  | { state: "stopped" }
  | { state: "refused"; why: string }
)

/** A machine of `hosts.toml`: this device's key for it, where ssh goes,
 * and the `banda` it runs there, or none to find this build's own there
 * (ADR 0081, decision 4; ADR 0095, decision 2). */
export type HostEntry = { name: string; ssh: string; banda?: string }

/**
 * What Test, and Add's Connect, find at an address over ssh, starting
 * nothing there (ADR 0095, decision 9; #837): found, with the system the
 * machine runs, its own name and icon, the `banda` found there and this
 * window's own, and its engine while one runs, by what it says of itself
 * (`banda status`), whether it speaks this window's protocol; waiting for
 * the Person to sign in to Tailscale at `url`, Test asked again once they
 * have; away; or refused. `why` is as a host's state's.
 */
export type HostTest =
  | {
      state: "found"
      /** As its `banda status` says it, "Arch Linux", "macOS 26.1"; from
       * a banda before that, "Linux" or "macOS", as its `uname` says;
       * none when neither does. Plain text, cut short. */
      system: string | null
      /** Its own name and icon, as its `machine.toml` says them over what
       * Banda finds there (ADR 0095, decisions 2 and 3), cleaned as the
       * page cleans a Welcome's; none from a banda before them. */
      named: Named | null
      banda: { build: string | null; version: string | null }
      own: { build: string | null; version: string | null }
      engine: {
        build: string | null
        version: string | null
        speaks: boolean
      } | null
    }
  | { state: "signin"; url: string }
  | { state: "away"; why: string }
  | { state: "refused"; why: string }

/** The page's route that draws Pane `pane` alone, in a window of its
 * own (ADR 0025, decision 9). */
export const poppedRoute = (pane: string) => `#pane/${pane}`

/** The Pane the page at `hash` draws alone, if it is such a window's: an
 * ID as the engine makes them. */
export function poppedOf(hash: string): string | undefined {
  return /^#pane\/([\w-]{1,64})$/.exec(hash)?.[1]
}

/**
 * What a Pane in its own window asks of the window, which has the
 * workspaces: to open a Pane beside it, as a Thread its terminal, or to
 * run an action.
 */
export type PoppedAsk =
  | {
      open: { project: ProjectId; pane: PaneState; from: string; place?: Place }
    }
  | { run: { action: string; args?: Args } }

/**
 * Takes a channel's current value, then each new one it tells. A value
 * told while the first answer was on its way is the newer, so it wins.
 */
export function follow<T>(
  channel: {
    current: () => Promise<T>
    listen: (listener: (value: T) => void) => unknown
  },
  take: (value: T) => void
): void {
  let told = false
  void channel.current().then((first) => told || take(first))
  channel.listen((value) => {
    told = true
    take(value)
  })
}

/**
 * What a device can do for a Pane, the closed list of capabilities (ADR
 * 0082, decision 12, as ADR 0106 decision 6 amends it): tell, sound, the
 * clipboard, pick a file, open outside Banda, draw a page, drag out, and
 * save a copy. A web client has no `webview` and no `drag_out`.
 */
export type Cap =
  | "notify"
  | "sound"
  | "clipboard"
  | "pick_file"
  | "open_outside"
  | "webview"
  | "drag_out"
  | "save_file"
