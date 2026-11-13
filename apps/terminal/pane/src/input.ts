import type { Params } from "@banda/contract"
import type { Size, TerminalId } from "@banda/contract/terminal"

/** The most one `terminal.write` carries: 16,384 UTF-16 units is at most 48 KB, under the engine's 64 KB. */
const AT_ONCE = 16 * 1024

/** How Input calls the engine. */
type Send = <M extends "terminal.write" | "terminal.resize">(
  method: M,
  params: Params<M>
) => Promise<unknown>

/** How many writes and sizes are on their way at once, at most, to an
 * engine that runs them in the order sent: past it, what is typed
 * meanwhile goes as one, as a paste's pieces do. */
const ON_THEIR_WAY = 8

/**
 * What a Pane sends one terminal, in the order the Person did it. An
 * engine that runs a session's writes and sizes in the order sent says so
 * as the terminal's screen comes (`inOrder`, from its snapshot): from
 * then on each key goes as it is typed, before the last one's answer, so
 * its echo is one round trip away, never two. Until an engine says so, as
 * one older than that order never does, it runs them side by side, so
 * each waits for the one before it, and what is typed meanwhile goes in
 * one call. Only the last size
 * counts. A size that does not reach the program is not worth a word, as
 * the next one replaces it; typing that does not is. A key goes now or
 * never (ADR 0106, decision 4): one refused, as its machine is away, is
 * said and gone, kept nowhere to go later by itself.
 */
export class Input {
  readonly #send: Send
  readonly #terminal: TerminalId
  readonly #onProblem: (error: unknown) => void
  #typed = ""
  #size: Size | null = null
  /** How many calls are on their way. */
  #sent = 0
  /** The engine said it runs them in the order sent. */
  #inOrder = false

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
    this.#flush()
  }

  resize(size: Size): void {
    this.#size = size
    this.#flush()
  }

  /** Whether its engine runs what it sends in the order sent, as the
   * terminal's snapshot says each time its screen comes. */
  inOrder(yes: boolean): void {
    this.#inOrder = yes
    this.#flush()
  }

  #flush(): void {
    const terminal = this.#terminal
    while (
      (this.#size || this.#typed) &&
      this.#sent < (this.#inOrder ? ON_THEIR_WAY : 1)
    ) {
      const size = this.#size
      let answered: Promise<unknown>
      if (size) {
        this.#size = null
        answered = this.#send("terminal.resize", { terminal, size }).catch(
          () => undefined
        )
      } else {
        const [data, rest] = cut(this.#typed)
        this.#typed = rest
        answered = this.#send("terminal.write", { terminal, data }).catch(
          this.#onProblem
        )
      }
      // On its way until it answered; then what waited goes.
      this.#sent++
      void answered.finally(() => {
        this.#sent--
        this.#flush()
      })
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
