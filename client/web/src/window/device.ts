/**
 * The device as the Window reaches it: the Window's part of what the
 * desktop gives the page on `window.banda` (`host.ts`, ADR 0028), and its
 * only way there. Nothing else in the Window or the Tiling names
 * `window.banda` (architecture.test.ts); W0 makes this the device port's
 * desktop adapter (ADR 0089, decision 2). Without the desktop, as in a
 * page of its own, each part does nothing, and what answers says so.
 */
import type { Host, PoppedAsk } from "../host"

/** The desktop's bridge as each part is used; none without the desktop. */
const desktop = (): Host | undefined => window.banda

export const device = {
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
     * they change, until it is stopped. */
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
}
