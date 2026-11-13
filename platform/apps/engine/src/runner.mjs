// Banda's loop for an App's worker on Node (ADR 0126, decision 3). The
// engine starts `node runner.mjs <entry>` once for an App on a machine and
// talks to it in lines of JSON, on its stdin and stdout:
//
//   ← {"ready":["add","find"]}
//   → {"id":1,"call":"add","params":{…},"by":{…},"project":{"id":"…","folder":"…"}}
//   ← {"id":1,"read":7,"sql":"SELECT … WHERE city = ?","params":["Berlin"]}
//   → {"read":7,"rows":[{…}]}            or {"read":7,"error":"…"}
//   ← {"id":1,"answer":{…},"write":[{"sql":"INSERT …","params":[…]}],"emit":[{"kind":"added",…}]}
//   ← {"id":2,"refuse":{"code":"not_found","message":"No client 12."}}
//
// The App's entry exports `methods`, each a function of its params and of
// what the call gives:
//
//   export const methods = {
//     async find({ city }, { read }) {
//       return { answer: await read("SELECT * FROM clients_people WHERE city = ?", [city]) }
//     },
//   }
//
// - `read(sql, params)` answers rows of the App's own tables in the
//   call's Project, each an object by column.
// - `refuse(code, message)` makes the refusal a method throws: `throw
//   refuse("not_found", "No client 12.")`, with "invalid", "not_found",
//   "forbidden" or "conflict".
// - `by` is who calls, `{ kind: "person" | "agent", id }`, and `project`
//   the Project it calls in, `{ id, folder }`: in its folder a Person's
//   documents are plain files.
//
// A method answers `{ answer, write, emit }`. The engine does the writing:
// `write` is statements on the App's own tables, `emit` its events, and a
// command's are kept in one transaction with its receipt.
//
// One process serves every Project and every caller, and its calls run
// side by side: what the App keeps, it keeps in its tables, not in the
// module. stdout is the engine's: what the App prints goes to stderr, and
// so to the engine's log.
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"

// The lines are written by the stdout this started with; whatever else
// writes to stdout, the console or a library, writes to stderr.
const lines = process.stdout.write.bind(process.stdout)
process.stdout.write = process.stderr.write.bind(process.stderr)
const say = (line) => lines(`${JSON.stringify(line)}\n`)

// What an App leaves unhandled is said, and the worker goes on: one call's
// slip ends no other's.
for (const slip of ["uncaughtException", "unhandledRejection"])
  process.on(slip, (error) => console.error(`${slip}:`, error))

const { methods = {} } = await import(pathToFileURL(process.argv[2]).href)

class Refused extends Error {
  constructor(code, message) {
    super(message)
    this.refusal = { code, message }
  }
}
const refuse = (code, message) => new Refused(code, String(message))

let asked = 0
const reads = new Map()
const read =
  (id) =>
  (sql, params = []) =>
    new Promise((resolve, reject) => {
      const ask = ++asked
      reads.set(ask, (answer) =>
        "error" in answer
          ? reject(new Error(answer.error))
          : resolve(answer.rows)
      )
      say({ id, read: ask, sql, params })
    })

async function run({ id, call, params, by, project }) {
  try {
    const gives = { read: read(id), refuse, by, project }
    const done = (await methods[call].call(methods, params ?? {}, gives)) ?? {}
    const { answer = null, write, emit } = done
    say({ id, answer, write: write ?? [], emit: emit ?? [] })
  } catch (error) {
    if (!error?.refusal) console.error(error)
    const thrown = { code: "internal", message: String(error) }
    say({ id, refuse: error?.refusal ?? thrown })
  }
}

const exported = Object.keys(methods).filter(
  (name) => typeof methods[name] === "function"
)
say({ ready: exported })
for await (const text of createInterface({ input: process.stdin })) {
  if (!text.trim()) continue
  const line = JSON.parse(text)
  if ("call" in line) {
    void run(line)
  } else {
    reads.get(line.read)?.(line)
    reads.delete(line.read)
  }
}
