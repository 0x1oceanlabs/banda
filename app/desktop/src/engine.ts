/**
 * The engine as the window's child: `banda serve --with-parent`. It
 * starts the engine, learns its address from the first line, starts it
 * again when it dies, and stops it when the window quits. Closing its
 * stdin is how the engine hears the window is gone.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { Address } from "@banda/contract"

/** The first line `serve --with-parent` prints. */
type Running = { protocol: number; port: number; secret: string }

const FIRST_WAIT = 500
const LONGEST_WAIT = 10_000
/** An engine that ran this long without dying starts again at once. */
const HEALTHY = 30_000
/** How long a stopping engine has before it is killed. */
const STOPPING = 5_000

export class EngineProcess {
  readonly #binary: string
  #child: ChildProcess | null = null
  #address: Address | null = null
  #waiting: Array<(address: Address) => void> = []
  #wait = FIRST_WAIT
  #stopping = false

  constructor(binary: string) {
    this.#binary = binary
  }

  /** Where the engine listens; waits while it starts. */
  address(): Promise<Address> {
    if (this.#address) return Promise.resolve(this.#address)
    return new Promise((resolve) => this.#waiting.push(resolve))
  }

  start(): void {
    if (this.#stopping) return
    const started = Date.now()
    const child = spawn(this.#binary, ["serve", "--with-parent"], {
      stdio: ["pipe", "pipe", "inherit"],
    })
    this.#child = child
    createInterface({ input: child.stdout! }).once("line", (line) => {
      let running: Running
      try {
        running = JSON.parse(line)
      } catch {
        console.error(`banda: the engine said something unexpected: ${line}`)
        child.kill()
        return
      }
      this.#address = {
        url: `ws://127.0.0.1:${running.port}/ws`,
        secret: running.secret,
      }
      for (const resolve of this.#waiting.splice(0)) resolve(this.#address)
    })
    child.once("error", (error) => {
      console.error(`banda: the engine did not start: ${error.message}`)
    })
    // `close` comes after an exit, and also after a start that failed.
    child.once("close", (code, signal) => {
      this.#child = null
      this.#address = null
      if (this.#stopping) return
      if (Date.now() - started > HEALTHY) this.#wait = FIRST_WAIT
      const wait = this.#wait
      this.#wait = Math.min(wait * 2, LONGEST_WAIT)
      console.error(
        `banda: the engine stopped (${signal ?? `code ${code}`}); starting it again in ${wait} ms`
      )
      setTimeout(() => this.start(), wait)
    })
  }

  /** Stops the engine for good, and resolves once it has gone. */
  stop(): Promise<void> {
    this.#stopping = true
    const child = this.#child
    if (!child) return Promise.resolve()
    return new Promise((done) => {
      const kill = setTimeout(() => child.kill("SIGKILL"), STOPPING)
      child.once("close", () => {
        clearTimeout(kill)
        done()
      })
      child.stdin!.end()
    })
  }
}
