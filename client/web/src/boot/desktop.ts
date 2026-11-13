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
import type { Listed } from "@banda/contract/look"
import type {
  ActAnswer,
  ActAsk,
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
    /** Starts host `name`'s engine again there, as the Person asks; no
     * name is this machine's own. Settled once the desktop was told. */
    start: (name: string): Promise<void> =>
      desktop()
        ?.hostStart(name)
        .catch((error: unknown) => {
          console.error(`banda: ${name || "the engine"} was not started`, error)
        }) ?? Promise.resolve(),
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
    /** Install: this build's Banda put on the machine at `ssh`, where Test
     * found none (ADR 0119, decision 8); `told` hears each line its
     * `install.sh` says there, as it comes. The version in place. */
    install: async (
      ssh: string,
      told: (line: string) => void
    ): Promise<{ version: string; path: string }> => {
      const bridge = desktop()
      if (!bridge) return elsewhere()
      const stop = bridge.hostInstalling.listen((said) => {
        if (said.ssh === ssh) told(said.line)
      })
      try {
        return await bridge.hostInstall(ssh)
      } finally {
        stop()
      }
    },
    /** Cancel: ends the Install running at `ssh`. */
    cancelInstall: (ssh: string): Promise<void> =>
      desktop()?.hostInstallCancel(ssh) ?? elsewhere(),
    /** ssh's arguments to run `remote` at `ssh` on a terminal there, as
     * Banda's own ssh but free to ask (ADR 0119, decision 8). */
    terminalArgs: (ssh: string, remote: string): Promise<string[]> =>
      desktop()?.hostTerminal(ssh, remote) ?? elsewhere(),
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
  /** Actions asked of the Window from outside the page (ADR 0127,
   * decision 2): by the engine, for `banda act` and an Agent's `act`
   * tool, and by the desktop itself, as its menu bar. */
  act: {
    /** Calls `listener` with each action the Window is asked to run,
     * until it is stopped. */
    asked: (listener: (asked: ActAsk) => void) =>
      desktop()?.act.asked(listener),
    /** Answers one: the Window ran it, or why not. */
    answer: (answer: ActAnswer): void => desktop()?.act.answer(answer),
  },
  /** The Banda menu, as `banda menu ROUTE` opens it (ADR 0017, decision
   * 7). */
  menu: {
    /** Calls `listener` with each route the menu is asked to open at,
     * until it is stopped. */
    listen: (listener: (route: string) => void) =>
      desktop()?.menu.listen(listener),
  },
  /** `sidebar.toml` (ADR 0008), whose keys the settings write. */
  sidebar: {
    /** Opens the file in the Person's editor; nothing without the
     * desktop. */
    edit: (): void => {
      desktop()
        ?.sidebar.edit()
        .catch((error: unknown) => {
          console.error("banda: sidebar.toml did not open", error)
        })
    },
  },
  /** The settings' files (ADR 0016). */
  settings: {
    /** Sets `key` in `file` to `value`, TOML; what was wrong, if refused. */
    set: (file: string, key: string, value: string) =>
      desktop()?.settings.set(file, key, value) ??
      Promise.resolve(["Only Banda's app writes the settings."]),
    /** Takes `key` out of `file`; what was wrong, if refused. */
    reset: (file: string, key: string) =>
      desktop()?.settings.reset(file, key) ??
      Promise.resolve(["Only Banda's app writes the settings."]),
    /** The themes there are, as `banda look themes` lists them (ADR
     * 0007); none without the desktop. */
    themes: (): Promise<Listed[]> =>
      desktop()?.settings.themes() ?? Promise.resolve([]),
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
    /** Saves a copy of the file the byte URL `url` names where the Person
     * picks, offered as `name` (`save_file`); none without the desktop. */
    save: (url: string, name: string) => desktop()?.files.save(url, name),
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
