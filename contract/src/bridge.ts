/**
 * The desktop bridge as one table (ADR 0028): what the page may ask of
 * Electron's main process on `window.banda`, and what main tells it. Each
 * leaf says what the page does with it, and its path, with dots, is its
 * channel's name. The page's API is the table's type (`HostOf`), the
 * preload builds it from the table, and main answers the table's leaves.
 * Types and names only, without Effect (ADR 0020, decision 1).
 */

/** A channel the page invokes with `Args`, and waits for its `Reply`. */
export type Invoke<Args extends unknown[], Reply> = Named & {
  readonly dir: "invoke"
  /** Only the types: nothing is kept here. */
  readonly types?: (...args: Args) => Reply
}

/** A channel the page sends `Args` to, and does not wait on. */
export type Send<Args extends unknown[]> = Named & {
  readonly dir: "send"
  readonly types?: (...args: Args) => void
}

/** A channel main tells the page each `Value` on. */
export type Push<Value> = Named & {
  readonly dir: "push"
  readonly types?: (value: Value) => void
}

type Named = {
  /** The channel's name, its path in the window's table: `bridge` sets it. */
  name: string
}

/** Any leaf: what the preload and main read of one, whatever its types. */
export type Leaf = Named & { readonly dir: "invoke" | "send" | "push" }

/** A table of channels, its parts nested by name. */
export type Table = { readonly [name: string]: Leaf | Table }

export const invoke = <Args extends unknown[] = [], Reply = void>(): Invoke<
  Args,
  Reply
> => ({ dir: "invoke", name: "" })

export const send = <Args extends unknown[]>(): Send<Args> => ({
  dir: "send",
  name: "",
})

export const push = <Value>(): Push<Value> => ({ dir: "push", name: "" })

/** `table` with `each` of its leaves in their place, given its path. */
export function mapTable(
  table: Table,
  each: (leaf: Leaf, path: string) => unknown,
  at = ""
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(table).map(([key, part]) => [
      key,
      typeof part.dir === "string"
        ? each(part as Leaf, `${at}${key}`)
        : mapTable(part as Table, each, `${at}${key}.`),
    ])
  )
}

/** Names each leaf of the window's `table` by its path, and answers it. */
export function bridge<T extends Table>(table: T): T {
  mapTable(table, (leaf, path) => (leaf.name = path))
  return table
}

/** What the page gets of a table: a function for each leaf, nested as it. */
export type HostOf<T> = {
  readonly [K in keyof T]: T[K] extends Invoke<infer Args, infer Reply>
    ? (...args: Args) => Promise<Reply>
    : T[K] extends Send<infer Args>
      ? (...args: Args) => void
      : T[K] extends Push<infer Value>
        ? (listener: (value: Value) => void) => () => void
        : HostOf<T[K]>
}
