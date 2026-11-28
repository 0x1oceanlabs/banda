/**
 * The driver's lines (ADR 0132, decision 3): a request is one line of
 * JSON, `{"id", "method", "params"}`, and its answer one line,
 * `{"id", "ok"}` or `{"id", "refused": {"code", "message"}}`, by the
 * engine's own codes. Requests are answered as each is done, not in the
 * order they came. The input closing ends it: every Chromium is closed.
 */
import { createInterface } from "node:readline"
import type { Readable, Writable } from "node:stream"
import type { Code } from "@banda/contract"
import type { Calls } from "./browsers"
import { fieldsOf } from "./decode"
import { messageOf, Refusal } from "./refusal"

type Answer =
  | { id: number; ok: unknown }
  | { id: number; refused: { code: Code; message: string } }

/** How the engine hears what `error` is: a refusal by its code, a
 * conflict unless it says; anything else is the driver's own fault. */
const refused = (error: unknown): { code: Code; message: string } =>
  error instanceof Refusal
    ? { code: error.code ?? "conflict", message: error.message }
    : { code: "internal", message: messageOf(error) }

/** Answers the requests of `input` on `output` with `calls`, until
 * `input` closes and every Chromium is closed. What is no request is
 * said to `log` and skipped. */
export async function serve(
  input: Readable,
  output: Writable,
  calls: Calls,
  log: (message: string) => void = console.error
): Promise<void> {
  const answer = (answer: Answer) => output.write(`${JSON.stringify(answer)}\n`)
  const lines = createInterface({ input, crlfDelay: Infinity })
  lines.on("line", (line) => {
    if (!line.trim()) return
    let request: ReturnType<typeof fieldsOf>
    try {
      request = fieldsOf(JSON.parse(line))
    } catch {
      request = undefined
    }
    const id = request?.id
    if (!request || typeof id !== "number") {
      log(`browser-driver: not a request, skipped: ${line.slice(0, 200)}`)
      return
    }
    const { method } = request
    const params = fieldsOf(request.params ?? {})
    if (typeof method !== "string" || !params) {
      answer({
        id,
        refused: {
          code: "invalid",
          message: 'A request is {"id", "method", "params"}.',
        },
      })
      return
    }
    calls.call(method, params).then(
      // A call that answers nothing answers null: a line has its `ok`.
      (ok) => answer({ id, ok: ok ?? null }),
      (error: unknown) => answer({ id, refused: refused(error) })
    )
  })
  await new Promise<void>((done) => lines.once("close", done))
  await calls.close()
}
