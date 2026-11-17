/**
 * The engine's own model of the workspaces, run here (ADR 0088, decision
 * 11; ADR 0135): `platform/tiling`, compiled to WebAssembly
 * (`platform/tiling/wasm`). A command goes in as JSON and its answer comes
 * back as JSON, so what the window draws ahead of the engine is what the
 * engine will say, by the same code.
 *
 * The file is compiled once, as this module loads: whoever imports it
 * waits for that, and `apply` itself does not wait. The words that cross
 * are typed here by hand until the window calls this for its own
 * (`arrangement.ts` goes then, and its types come from Rust).
 */
import bytes from "virtual:banda/tiling-model"
import type { Code } from "@banda/contract"
import type { Workspace } from "@banda/contract/workspaces"
import {
  type Answer,
  type Applied,
  type Command,
  type Facts,
  NO_FACTS,
} from "./arrangement"

type Model = {
  memory: WebAssembly.Memory
  alloc: (len: number) => number
  apply: (ptr: number, len: number) => bigint
}

// The model imports nothing, so it is given nothing.
const compiled = await WebAssembly.compile(
  Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0))
)
let model = new WebAssembly.Instance(compiled).exports as Model

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** What the model answers: a command's answer with the arrangement after
 * it, or the engine's refusal. */
type Said =
  | { answer: Answer; list: Workspace[] }
  | { refused: { code: Code; message: string } }

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
  const asked = encoder.encode(
    JSON.stringify({
      list,
      method: command.method.replace(/^workspaces\./, ""),
      params: command.params,
      facts,
      seed,
    })
  )
  let text: string
  try {
    // A pointer is unsigned, and WebAssembly hands it over signed.
    const at = model.alloc(asked.length) >>> 0
    new Uint8Array(model.memory.buffer, at, asked.length).set(asked)
    const answer = BigInt.asUintN(64, model.apply(at, asked.length))
    text = decoder.decode(
      new Uint8Array(
        model.memory.buffer,
        Number(answer >> 32n),
        Number(answer & 0xffff_ffffn)
      )
    )
  } catch (error) {
    // The model panicked, which stops it for good: the next command gets
    // a fresh one, and this one says which command it was.
    model = new WebAssembly.Instance(compiled).exports as Model
    throw new Error(`The Tiling's model stopped on ${command.method}.`, {
      cause: error,
    })
  }
  const said = JSON.parse(text) as Said
  return "refused" in said
    ? { refused: said.refused.code, message: said.refused.message }
    : { list: said.list, answer: said.answer }
}
