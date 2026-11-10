/**
 * The device as the page reaches it on the desktop, its adapter: the part
 * of what the desktop gives the page on `window.banda` (`Host`, the
 * bridge's table in `client/desktop/src/bridge.ts`, ADR 0028) that the
 * Window uses, and its only way there. Nothing else in the Window or the
 * Tiling names `window.banda`, and at last nothing else in the page does
 * (architecture.test.ts; ADR 0089, decisions 2 and 11). Its callers reach
 * it through `boot/index.ts`. Without the desktop, as in a page of its
 * own, each part does nothing, and what answers says so.
 */
import type { Address } from "@banda/contract"
import type {
  Cap,
  HostEntry,
  HostState,
  HostTest,
  PoppedAsk,
} from "@banda/core"
import type { Host } from "@banda/desktop/bridge"

/** The desktop's bridge as each part is used; none without the desktop. */
const desktop = (): Host | undefined => window.banda

/** Why a host's part does nothing without the desktop, in the Person's
 * words, which Settings shows as they are. */
export const ELSEWHERE = "Only Banda's app reaches other machines."

/** What a host's part answers without the desktop. */
const elsewhere = () => Promise.reject(new Error(ELSEWHERE))

export const device = {
  /** The other machines of `hosts.toml`, as the desktop reaches them over
   * ssh (ADR 0081, decision 4). */
  hosts: {
    /** Hands `take` the hosts now, then each time one changes, until it
     * is stopped. A change told while the first answer was on its way is
     * the newer, so it wins. */
    follow: (take: (hosts: HostState[]) => void) => {
      const hosts = desktop()?.hosts
      if (!hosts) return undefined
      let on = true
      let told = false
      hosts.current().then(
        (first) => on && !told && take(first),
        (error: unknown) =>
          console.warn("banda: the hosts were not read", error)
      )
      const stop = hosts.listen((now) => {
        told = true
        take(now)
      })
      return () => {
        on = false
        stop()
      }
    },
    /** Where host `name`'s engine listens: asked of the desktop each time,
     * and kept nowhere in the page. */
    engine: (name: string): Promise<Address> =>
      desktop()?.hostEngine(name) ?? elsewhere(),
    /** Starts host `name`'s engine again there, as the Person asks. */
    start: (name: string): void => {
      desktop()
        ?.hostStart(name)
        .catch((error: unknown) => {
          console.error(`banda: ${name} was not started`, error)
        })
    },
    /** Stops Banda on host `name`, as the Person asks. */
    stop: (name: string, force: boolean): Promise<"stopped" | "working"> =>
      desktop()?.hostStop(name, force) ?? elsewhere(),
    /** Adds the machine at `ssh` to `hosts.toml`, as Settings' Add does:
     * its key made from the address; the entry written. */
    add: (machine: { ssh: string; banda?: string }): Promise<HostEntry> =>
      desktop()?.hostAdd(machine) ?? elsewhere(),
    /** Changes host `name`'s address or its `banda` in `hosts.toml`; an
     * empty `banda` is none. The entry written. */
    set: (
      name: string,
      change: { ssh?: string; banda?: string }
    ): Promise<HostEntry> => desktop()?.hostSet(name, change) ?? elsewhere(),
    /** Takes host `name` out of `hosts.toml`; its Projects stay there. */
    remove: (name: string): Promise<void> =>
      desktop()?.hostRemove(name) ?? elsewhere(),
    /** What is at `ssh`, with `banda` or this build's own, starting
     * nothing there: Test connection, and Add's Connect. */
    test: (ssh: string, banda: string | null): Promise<HostTest> =>
      desktop()?.hostTest(ssh, banda) ?? elsewhere(),
    /** The Hosts of `~/.ssh/config` to suggest for Add; none without the
     * desktop. */
    suggestions: (): Promise<string[]> =>
      desktop()?.sshSuggestions() ?? Promise.resolve([]),
  },
  /** Panes in windows of their own (ADR 0025, decision 9): main keeps
   * which, and opens and closes their windows. */
  popped: {
    /** Opens Pane `pane` in a window of its own, `width` by `height`, or
     * brings that window to the front. */
    open: (pane: string, width: number, height: number): void =>
      desktop()?.popped.open(pane, width, height),
    /** Closes Pane `pane`'s window: it is back in its place. */
    close: (pane: string): void => desktop()?.popped.close(pane),
    /** Hands `take` the Panes in windows of their own now, then each time
     * they change, until it is stopped. Unlike `@banda/core`'s `follow`, a
     * first answer that comes after a change is still taken, as the
     * Window has always taken it. */
    follow: (take: (panes: ReadonlySet<string>) => void) => {
      const popped = desktop()?.popped
      if (!popped) return undefined
      let on = true
      void popped.current().then((ids) => on && take(new Set(ids)))
      const stop = popped.listen((ids) => take(new Set(ids)))
      return () => {
        on = false
        stop()
      }
    },
    /** Asks the window, from a Pane in its own window, to open a Pane or
     * run an action: main hands it on. */
    ask: (asked: PoppedAsk): void => desktop()?.popped.ask(asked),
    /** Calls `listener` with each thing a popped Pane asks, until it is
     * stopped. */
    asked: (listener: (asked: PoppedAsk) => void) =>
      desktop()?.popped.asked(listener),
  },
  /** The Banda menu, as `banda menu ROUTE` opens it (ADR 0017, decision
   * 7). */
  menu: {
    /** Calls `listener` with each route the menu is asked to open at,
     * until it is stopped. */
    listen: (listener: (route: string) => void) =>
      desktop()?.menu.listen(listener),
  },
  /** `sidebar.toml`, which the desktop writes (ADR 0008). */
  sidebar: {
    /** Arranges the sidebar by the preset `name`: the desktop writes it
     * into the file, and the arrangement comes back with the look. */
    preset: (name: string): void => {
      desktop()
        ?.sidebar.preset(name)
        .catch((error: unknown) => {
          console.error("banda: the sidebar's preset was not written", error)
        })
    },
  },
  /** The settings' files (ADR 0016). */
  settings: {
    /** Sets `key` in `file` to `value`, TOML; what was wrong, if refused. */
    set: (file: string, key: string, value: string) =>
      desktop()?.settings.set(file, key, value) ??
      Promise.resolve(["Only Banda's app writes the settings."]),
  },
  /** Files on the machine, by their full path (ADR 0073, decision 14). */
  files: {
    /** Whether a file, or a folder, is there; no answer without the
     * desktop. */
    exists: (file: string) => desktop()?.files.exists(file),
    /** Opens the file in the app the system has for it. */
    outside: (file: string): void => desktop()?.files.outside(file),
    /** Shows the file in its folder, in the system's file manager. */
    show: (file: string): void => desktop()?.files.show(file),
  },
  /** Editing in the page, as the system's menu does (ADR 0063, decision
   * 3): the page never reads the clipboard itself. */
  edit: {
    paste: (): void => desktop()?.edit.paste(),
    pastePlain: (): void => desktop()?.edit.pastePlain(),
    /** Copies the image at a point of the page. */
    copyImageAt: (x: number, y: number): void =>
      desktop()?.edit.copyImageAt(x, y),
  },
  /** Banda's own update (ADR 0041). */
  update: {
    check: (): void => desktop()?.update.check(),
    /** Installs the version that is ready and starts it. */
    restart: (): void => desktop()?.update.restart(),
  },
  /** Quits Banda: stops the engine and closes the window (ADR 0086,
   * decision 3). */
  quit: (): void => desktop()?.quit(),
  /** What this device can do for a Pane (ADR 0082, decision 12): the
   * desktop all of the list; a page of its own what a browser does, the
   * clipboard, telling and sounds. */
  has: (cap: Cap): boolean => desktop() !== undefined || IN_A_BROWSER.has(cap),
}

/** What a page of its own can do, with no desktop. */
const IN_A_BROWSER: ReadonlySet<Cap> = new Set(["clipboard", "notify", "sound"])
