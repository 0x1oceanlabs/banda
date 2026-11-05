/** A fake engine for the git Pane's tests: each stream asked is kept,
 * for the test to say its pieces and end it by hand; each call is kept
 * too, answered by `answers` by its method. */
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

export function fakeEngine(answers: Record<string, unknown> = {}): {
  engine: Engine
  streams: Heard[]
  calls: Called[]
} {
  const streams: Heard[] = []
  const calls: Called[] = []
  const fake = {
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
  return { engine: fake as unknown as Engine, streams, calls }
}
