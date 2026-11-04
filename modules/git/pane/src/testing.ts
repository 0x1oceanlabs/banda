/** A fake engine for the git Pane's tests: each stream asked is kept,
 * for the test to say its pieces and end it by hand. */
import type { Engine, Refusal } from "@banda/contract"

export type Heard = {
  method: string
  onPiece: (piece: never) => void
  onEnd: (refusal?: Refusal) => void
  once: boolean
  stopped: boolean
}

export function fakeEngine(): { engine: Engine; streams: Heard[] } {
  const streams: Heard[] = []
  const fake = {
    stream: (
      _space: string,
      method: string,
      _params: unknown,
      onPiece: (piece: never) => void,
      onEnd: (refusal?: Refusal) => void,
      how?: { once?: boolean }
    ) => {
      const heard = {
        method,
        onPiece,
        onEnd,
        once: !!how?.once,
        stopped: false,
      }
      streams.push(heard)
      return () => (heard.stopped = true)
    },
  }
  return { engine: fake as unknown as Engine, streams }
}
