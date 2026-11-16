/**
 * Whether the Person looks at Banda on another device (ADR 0124, decision
 * 10; SE7): each machine the window reaches says so of the devices that
 * hold its `devices.front`, this one apart. A window they do not look at
 * tells of nothing while one does: they are told once, where they are.
 */
export class Elsewhere {
  readonly #saying = new Set<object>()

  /** Whether some machine says so now. */
  readonly is = (): boolean => this.#saying.size > 0

  /** What `machine` says now; a machine no more heard says nothing. */
  say(machine: object, looks: boolean): void {
    if (looks) this.#saying.add(machine)
    else this.#saying.delete(machine)
  }
}

/** This window's. */
export const elsewhere = new Elsewhere()
