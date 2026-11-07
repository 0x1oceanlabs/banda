import type { Params } from "@banda/contract"
import type { Size, TerminalId } from "@banda/contract/terminal"

/** The most one `terminal.write` carries: 16,384 UTF-16 units is at most 48 KB, under the engine's 64 KB. */
const AT_ONCE = 16 * 1024

/** How Input calls the engine. */
type Send = <M extends "terminal.write" | "terminal.resize">(
  method: M,
  params: Params<M>
) => Promise<unknown>

/**
 * What a Pane sends one terminal, in the order the Person did it. The
 * engine runs calls side by side, so each waits for the one before it.
 * What is typed meanwhile goes in one call, and only the last size counts.
 * A size that does not reach the program is not worth a word, as the next
 * one replaces it; typing that does not is.
 */
export class Input {
  readonly #send: Send
  readonly #terminal: TerminalId
  readonly #onProblem: (error: unknown) => void
  #typed = ""
  #size: Size | null = null
  #sending = false

  constructor(
    send: Send,
    terminal: TerminalId,
    onProblem: (error: unknown) => void
  ) {
    this.#send = send
    this.#terminal = terminal
    this.#onProblem = onProblem
  }

  type(data: string): void {
    this.#typed += data
    void this.#flush()
  }

  resize(size: Size): void {
    this.#size = size
    void this.#flush()
  }

  async #flush(): Promise<void> {
    if (this.#sending) return
    this.#sending = true
    const terminal = this.#terminal
    try {
      while (this.#size || this.#typed) {
        const size = this.#size
        if (size) {
          this.#size = null
          await this.#send("terminal.resize", { terminal, size }).catch(
            () => undefined
          )
          continue
        }
        const [data, rest] = cut(this.#typed)
        this.#typed = rest
        await this.#send("terminal.write", { terminal, data }).catch(
          this.#onProblem
        )
      }
    } finally {
      this.#sending = false
    }
  }
}

/** The first piece of `text` one call carries, never half a character. */
function cut(text: string): [string, string] {
  if (text.length <= AT_ONCE) return [text, ""]
  const last = text.charCodeAt(AT_ONCE - 1)
  const at = last >= 0xd800 && last <= 0xdbff ? AT_ONCE - 1 : AT_ONCE
  return [text.slice(0, at), text.slice(at)]
}
