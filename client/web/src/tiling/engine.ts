/**
 * The engine's own model of the workspaces, run here (ADR 0088, decision
 * 11; ADR 0135): `platform/tiling`, compiled to WebAssembly
 * (`platform/tiling/wasm`). What the window asks goes in as JSON and the
 * answer comes back as JSON, so what the window draws ahead of the engine
 * is what the engine will say, by the same code. Where a Pane with no
 * place opens, and which move the row refuses, is the engine's to say
 * (ADR 0110): the window asks its model only to draw ahead, by the facts
 * it believes the engine has, and the engine's answer wins.
 *
 * The file is compiled once, as this module loads: whoever imports it
 * waits for that, and no call here waits.
 */
import type { Code, JsonValue, MethodOf, Params } from "@banda/contract"
import type {
  Facts,
  ModelAsked,
  RowRefusal,
  View,
  Workspace,
} from "@banda/contract/workspaces"
import bytes from "./engine.wasm"

export type { Facts, RowRefusal }

type Named = Extract<MethodOf<"command">, `workspaces.${string}`>

/** One of the workspaces module's commands, with its params. */
export type Command = {
  [M in Named]: { method: M; params: Params<M> }
}[Named]

/** What a command answers, as the engine does: the Pane for `open`, and
 * whether it is new. */
export type Answer = { pane?: string; new?: boolean }

/** What a command comes to: the workspaces after it and its answer, or
 * why it is refused, in the engine's words. */
export type Applied =
  { list: Workspace[]; answer: Answer } | { refused: Code; message: string }

/** The engine's facts when it knows no Flow and no kind. */
export const NO_FACTS: Facts = { flow: "free", home: [] }

type Model = {
  memory: WebAssembly.Memory
  alloc: (len: number) => number
  ask: (ptr: number, len: number) => bigint
}

// The model imports nothing, so it is given nothing.
const compiled = await WebAssembly.compile(
  Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0))
)
let model = new WebAssembly.Instance(compiled).exports as Model

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** The model's answer to `asked`, as it gives it. */
function ask(asked: ModelAsked): unknown {
  const said = encoder.encode(JSON.stringify(asked))
  let answered: unknown
  try {
    // A pointer is unsigned, and WebAssembly hands it over signed.
    const at = model.alloc(said.length) >>> 0
    new Uint8Array(model.memory.buffer, at, said.length).set(said)
    const answer = BigInt.asUintN(64, model.ask(at, said.length))
    answered = JSON.parse(
      decoder.decode(
        new Uint8Array(
          model.memory.buffer,
          Number(answer >> 32n),
          Number(answer & 0xffff_ffffn)
        )
      )
    )
  } catch (error) {
    // The model panicked, which stops it for good: the next call gets a
    // fresh one, and this one says what was asked.
    model = new WebAssembly.Instance(compiled).exports as Model
    throw new Error(`The Tiling's model stopped on ${asked.ask}.`, {
      cause: error,
    })
  }
  // What the window asked is no question of the model's: a fault here.
  if (typeof answered === "object" && answered && "unread" in answered)
    throw new Unread(
      `The Tiling's model cannot read ${asked.ask}: ${String(answered.unread)}`
    )
  return answered
}

/** What the window asked was no question of the model's. */
class Unread extends Error {}

/**
 * The model's answer to a question beside a command, or `none` where it
 * cannot read what it is asked, as the arrangement of a window that still
 * waits for the engine's: the engine decides either way, and the window
 * foresees nothing then.
 */
function foreseen<T>(asked: ModelAsked, none: T): T {
  try {
    return (ask(asked) as T | null) ?? none
  } catch (error) {
    if (!(error instanceof Unread)) throw error
    console.warn(error.message)
    return none
  }
}

/** A command as the model reads it: its name without its module's, and
 * its params. */
const read = (command: Command) => ({
  method: command.method.replace(/^workspaces\./, ""),
  params: command.params as JsonValue,
})

/**
 * Runs `command` on `list` as the engine runs it under the command ID
 * `seed`, from which what it makes takes its IDs, by `facts`. `list` stays
 * as it was, refused or not.
 */
export function apply(
  list: readonly Workspace[],
  command: Command,
  seed: string,
  facts: Facts = NO_FACTS
): Applied {
  let said:
    | { answer: Answer; list: Workspace[] }
    | { refused: { code: Code; message: string } }
  try {
    said = ask({
      ask: "apply",
      list: list as Workspace[],
      ...read(command),
      facts,
      seed,
    }) as typeof said
  } catch (error) {
    // As the engine refuses a call it cannot read: the command draws
    // nothing, and the engine's own answer shows.
    if (!(error instanceof Unread)) throw error
    return { refused: "invalid", message: error.message }
  }
  return "refused" in said
    ? { refused: said.refused.code, message: said.refused.message }
    : said
}

/**
 * The refusal the row gives `command`, by `facts`, as the engine answers
 * it over `list`: of a Pane, a column or a Group moved, and of a Pane
 * brought to a place; none for a command the row lets go, and for one
 * that moves nothing between workspaces. The window words the engine's
 * refusal by it, with the names it knows (ADR 0110, decision 8).
 */
export function refusalFor(
  list: readonly Workspace[],
  command: Command,
  facts: Facts
): RowRefusal | undefined {
  return foreseen<RowRefusal | undefined>(
    { ask: "refused", list: list as Workspace[], ...read(command), facts },
    undefined
  )
}

/**
 * The workspaces the row lets Pane `pane` move to no more, by their IDs:
 * alone, or `whole` with the Group it is in (ADR 0102, decision 6). What
 * the window dims while the Pane is carried, and greys out in its menu.
 */
export function refusedTo(
  list: readonly Workspace[],
  facts: Facts,
  pane: string,
  whole: boolean
): Set<string> {
  const asked = { ask: "refused_to", facts, pane, whole } as const
  return new Set(
    foreseen<string[]>({ ...asked, list: list as Workspace[] }, [])
  )
}

/** A new column's width for a Pane of `kind`, where the command names
 * none: the one its rule gives, else, for a list, the narrowest of the
 * Tiling's. */
export function widthIn(facts: Facts, kind: string): string | undefined {
  return foreseen<string | undefined>({ ask: "width", facts, kind }, undefined)
}

/** The arrangement as the view reads it: each workspace's columns and
 * each column's Panes, by their IDs. */
type Shape = Extract<ModelAsked, { ask: "look" }>["list"]

/**
 * `view` over the arrangement `list` as it stands now, with the Person's
 * act aimed at the Pane `aim`, if they did one that aims: the view to
 * draw, each ID with the place it has now, and to look by next (ADR 0135,
 * decisions 7 and 9). What it names nothing for is the first. A view the
 * model cannot read, as one kept by an older Banda may be, looks as none.
 */
export function look(list: Shape, view: View, aim?: string): View {
  const none: View = { focus: {}, active: {} }
  const asked = {
    ask: "look",
    list,
    ...(aim !== undefined && { aim }),
  } as const
  return (
    foreseen({ ...asked, view }, undefined) ??
    foreseen({ ...asked, view: none }, none)
  )
}
