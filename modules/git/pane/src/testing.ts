/** A fake engine for the git Pane's tests: each stream asked is kept,
 * for the test to say its pieces and end it by hand; each call is kept
 * too, answered by `answers` by its method, and each command run. */
import type { Engine, Refusal } from "@banda/contract"

export type Heard = {
  method: string
  params: unknown
  onPiece: (piece: never) => void
  onEnd: (refusal?: Refusal) => void
  once: boolean
  stopped: boolean
}

export type Called = { method: string; params: unknown }

/** A command run, with its params and Space. */
export type Ran = { method: string; params: unknown; space: string }

export function fakeEngine(answers: Record<string, unknown> = {}): {
  engine: Engine
  streams: Heard[]
  calls: Called[]
  commands: Ran[]
} {
  const streams: Heard[] = []
  const calls: Called[] = []
  const commands: Ran[] = []
  const fake = {
    command: (method: string, params: unknown, space: string) => {
      commands.push({ method, params, space })
      return Promise.resolve(null)
    },
    call: (method: string, params: unknown) => {
      calls.push({ method, params })
      return Promise.resolve(answers[method])
    },
    stream: (
      _space: string,
      method: string,
      params: unknown,
      onPiece: (piece: never) => void,
      onEnd: (refusal?: Refusal) => void,
      how?: { once?: boolean }
    ) => {
      const heard = {
        method,
        params,
        onPiece,
        onEnd,
        once: !!how?.once,
        stopped: false,
      }
      streams.push(heard)
      return () => (heard.stopped = true)
    },
  }
  return { engine: fake as unknown as Engine, streams, calls, commands }
}
