/**
 * The Panes closed while their machine was away (ADR 0106, decision 4):
 * the one act besides a message that waits for a machine, as ADR 0105
 * leaves room for. A Pane whose App lets go of it on its machine, as a
 * terminal stops its shell there, and whose close that machine could not
 * hear, waits here, on this device, for that machine to be back. Then
 * its App lets go of it there, before anything new goes. It waits 7
 * days, with no Keep for: a late close still does what the Person meant,
 * as no Pane draws what it ends. It names the boot of the engine it ran
 * under, and is dropped once that machine says another: what it would end
 * ended with that restart.
 *
 * It is kept beside the messages (`queue.ts`), in the same storage under
 * keys of its own, so it outlives a restart, every window on the device
 * sees it, and the pill counts both. One window lets go: the main one,
 * which `drains`. In the end shape it is `pane.left@1` (ADR 0101,
 * decision 5).
 */
import { newId, type ProjectId } from "@banda/contract"
import type { PaneState } from "./pane"
import type { WaitingStorage } from "./queue"
import { type Readable, sameData, Store } from "./store"

/** How long a close waits: the queue's longest, 7 days. */
export const LEFT_FOR = 7 * 24 * 60 * 60 * 1000

/** Where the storage keeps each, beside the messages' keys. */
const LEFT = "left."

/** A Pane closed while its machine was away. */
export type Leaving = {
  /** The machine, by its key in `hosts.toml`; `HERE` for this device's
   * own. */
  host: string
  /** The boot of its engine as last heard, none if never. */
  boot?: string
  project: ProjectId
  pane: PaneState
  /** Past this, in ms since the epoch by this device's clock, it is let go
   * of unsent. */
  until: number
  /** Where it is in the order closed on this device. */
  seq: number
}

/** The Panes closed while away, each under its key, in the order closed. */
export class Left implements Readable<readonly Leaving[]> {
  readonly #storage: WaitingStorage
  readonly #now: () => number
  readonly #all = new Store<readonly Leaving[]>([])
  /** Whether this window lets go of them: the main window's. */
  readonly drains: boolean

  constructor(
    storage: WaitingStorage,
    { now = Date.now, drains = true }: { now?: () => number; drains?: boolean }
  ) {
    this.#storage = storage
    this.#now = now
    this.drains = drains
    this.#read()
  }

  readonly get = (): readonly Leaving[] => this.#all.get()
  readonly subscribe = (listener: () => void) => this.#all.subscribe(listener)

  /** Follows what the other windows keep; returns how to stop. */
  follow(): () => void {
    this.#read()
    return this.#storage.follow(() => this.#read())
  }

  /** Keeps `pane`, of `project`, closed while `host` was away. */
  add(one: Omit<Leaving, "until" | "seq">): void {
    const seq = Math.max(0, ...this.#kept().map(([, kept]) => kept.seq)) + 1
    const kept: Leaving = { ...one, until: this.#now() + LEFT_FOR, seq }
    this.#storage.write(LEFT + newId(), JSON.stringify(kept))
    this.#read()
  }

  /**
   * What `host`'s engine, open again under boot `boot`, lets go of now:
   * each kept for it under that boot, or under none heard, in the order
   * closed. Every one of `host`'s goes from the storage, past its time or
   * of another boot too. None in a window that does not drain. What is
   * past its time goes as it is read, here or as the storage changes.
   */
  take(host: string, boot: string): Leaving[] {
    if (!this.drains) return []
    const now = this.#now()
    const taken: Leaving[] = []
    for (const [key, one] of this.#kept()) {
      if (one.host !== host) continue
      this.#storage.write(key, null)
      if (one.until > now && (one.boot === undefined || one.boot === boot))
        taken.push(one)
    }
    this.#read()
    return taken
  }

  /** Each kept, by its key, in the order closed; one unreadable is let go. */
  #kept(): [string, Leaving][] {
    const kept: [string, Leaving][] = []
    for (const [key, text] of this.#storage.read()) {
      if (!key.startsWith(LEFT)) continue
      try {
        kept.push([key, JSON.parse(text) as Leaving])
      } catch {
        this.#storage.write(key, null)
      }
    }
    return kept.sort(([, a], [, b]) => a.seq - b.seq)
  }

  #read(): void {
    const now = this.#now()
    const all = this.#kept()
      .map(([, one]) => one)
      .filter((one) => one.until > now)
    if (!sameData(all, this.#all.get())) this.#all.set(all)
  }
}
