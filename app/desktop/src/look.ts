/**
 * The look as the window's child: `bandaso look --follow` (ADR 0007,
 * decision 10). Each line it prints is the whole look; this keeps the
 * last one, hands it to whoever listens, and starts the program again if
 * it dies. The look is this machine's, so it needs no engine.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { type Look, shown } from "@bandaso/contract/look"

const FIRST_WAIT = 500
const LONGEST_WAIT = 10_000

export class LookProcess {
  readonly #binary: string
  #child: ChildProcess | null = null
  #look: Look | null = null
  #listeners = new Set<(look: Look) => void>()
  #wait = FIRST_WAIT
  #stopping = false

  constructor(binary: string) {
    this.#binary = binary
  }

  /** The last look it printed; none before the first. */
  current(): Look | null {
    return this.#look
  }

  /** The first look, or none once `within` ms went by without one: the
   * window waits that long to open in its colours. */
  first(within: number): Promise<Look | null> {
    if (this.#look) return Promise.resolve(this.#look)
    return new Promise((done) => {
      const stop = this.listen((look) => {
        clearTimeout(late)
        stop()
        done(look)
      })
      const late = setTimeout(() => {
        stop()
        done(null)
      }, within)
    })
  }

  /** Calls `listener` with each new look; returns how to stop. */
  listen(listener: (look: Look) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  start(): void {
    if (this.#stopping) return
    const child = spawn(this.#binary, ["look", "--follow"], {
      stdio: ["ignore", "pipe", "inherit"],
    })
    this.#child = child
    createInterface({ input: child.stdout! }).on("line", (line) => {
      let look: Look
      try {
        look = JSON.parse(line)
      } catch {
        console.error(`bandaso: the look said something unexpected: ${line}`)
        return
      }
      this.#wait = FIRST_WAIT
      this.#look = look
      for (const listener of this.#listeners) listener(look)
    })
    child.once("error", (error) => {
      console.error(`bandaso: the look did not start: ${error.message}`)
    })
    child.once("close", (code, signal) => {
      this.#child = null
      if (this.#stopping) return
      const wait = this.#wait
      this.#wait = Math.min(wait * 2, LONGEST_WAIT)
      console.error(
        `bandaso: the look stopped (${signal ?? `code ${code}`}); starting it again in ${wait} ms`
      )
      setTimeout(() => this.start(), wait)
    })
  }

  stop(): void {
    this.#stopping = true
    this.#child?.kill()
  }
}

/** The colour the window paints before the page draws, when it is hex. */
export function firstFrame(
  look: Look,
  systemDark: boolean
): string | undefined {
  const background = shown(look, systemDark).colors["--background"]
  return background && /^#[0-9a-f]{6}$/i.test(background)
    ? background
    : undefined
}
