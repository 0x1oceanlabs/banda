import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
const [wasmPath, folder] = process.argv.slice(2)
const mod = new WebAssembly.Module(readFileSync(wasmPath))
console.log(
  "imports:",
  WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}`)
)
const stubs = {}
for (const i of WebAssembly.Module.imports(mod))
  (stubs[i.module] ??= {})[i.name] = () => {
    throw new Error("import called: " + i.name)
  }
const { exports: x } = new WebAssembly.Instance(mod, stubs)
const enc = new TextEncoder(),
  dec = new TextDecoder()
function apply(input) {
  const bytes = enc.encode(JSON.stringify(input))
  const ptr = x.alloc(bytes.length)
  new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes)
  const packed = x.apply(ptr, bytes.length)
  const p = Number(packed >> 32n),
    l = Number(packed & 0xffffffffn)
  return JSON.parse(dec.decode(new Uint8Array(x.memory.buffer, p, l)))
}
const ordered = (v) =>
  Array.isArray(v)
    ? v.map(ordered)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, ordered(v[k])])
        )
      : v
const text = (v) => JSON.stringify(ordered(v))
let steps = 0,
  same = 0,
  refused = 0,
  bad = []
const inputs = []
for (const name of readdirSync(folder)
  .filter((n) => n.endsWith(".json"))
  .sort()) {
  const trace = JSON.parse(readFileSync(join(folder, name), "utf8"))
  let list = trace.start
  for (const [n, step] of trace.steps.entries()) {
    steps++
    const input = {
      list,
      method: step.method.replace(/^workspaces\./, ""),
      params: step.params,
      facts: step.facts ?? { flow: "free", home: [] },
      seed: step.seed,
    }
    inputs.push(input)
    const out = apply(input)
    if (step.refused !== undefined) {
      if (out.refused && out.refused.code === step.refused) {
        same++
        refused++
      } else
        bad.push(`${name}#${n} refused ${JSON.stringify(out).slice(0, 200)}`)
      continue
    }
    if (
      out.answer !== undefined &&
      text(out.answer) === text(step.answer) &&
      text(out.after) === text(step.after)
    )
      same++
    else bad.push(`${name}#${n} ${JSON.stringify(out).slice(0, 200)}`)
    list = step.after
  }
}
console.log({
  steps,
  same,
  refused,
  bad: bad.slice(0, 5),
  badCount: bad.length,
})
const t0 = performance.now()
for (let i = 0; i < 20; i++) for (const input of inputs) apply(input)
const ms = (performance.now() - t0) / (20 * inputs.length)
console.log("ms per command through wasm, JSON in and out:", ms.toFixed(4))
