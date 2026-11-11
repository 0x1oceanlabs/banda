// Checks that this change keeps the engine's contract good for the windows
// of the last Dev (ADR 0115, decision 6; ADR 0086, decision 6): machines
// update apart, so a window and an engine a version apart work together.
//
//   node scripts/contract.mjs [base]
//
// It compares the methods of sdk/contract/src/generated here with those at
// <base>: by default where this branch left origin/main, or, on main
// itself, the commit before, the last Dev. For a client built at <base>:
//
// - each method it calls is still here, of the same kind;
// - the params it sends are still taken: no new required field, no
//   narrower type;
// - the answer it reads still reads: no field gone, no wider type.
//
// TypeScript says which: an old method's params must be assignable to the
// new ones, and a new answer to the old one.
//
// A break that is meant is said in a commit of the branch, one trailer per
// method, with what an older window does without it:
//
//   Contract-Break: agents.snooze, renamed agents.later; an older window's Later fails until it updates
//
// The window of another build then lacks that method until it updates.
import { execFileSync } from "node:child_process"
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const GENERATED = "sdk/contract/src/generated"
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim()
const tried = (...args) => {
  try {
    return git(...args)
  } catch {
    return undefined
  }
}

const head = git("rev-parse", "HEAD")
let base = process.argv[2] ?? tried("merge-base", "HEAD", "origin/main")
if (!base || git("rev-parse", base) === head)
  base = tried("rev-parse", "HEAD~1")
if (!base) {
  console.log("contract: no commit to compare with; nothing to check")
  process.exit(0)
}
// A shallow checkout, as CI's, may not have it yet.
if (tried("cat-file", "-e", `${base}^{commit}`) === undefined) {
  git("fetch", "--quiet", "--depth=1", "origin", base)
}
base = git("rev-parse", base)
if (tried("cat-file", "-e", `${base}:${GENERATED}/Methods.ts`) === undefined) {
  console.log(
    `contract: ${base.slice(0, 9)} has no ${GENERATED}; nothing to check`
  )
  process.exit(0)
}

// What the branch's commits say they break on purpose.
const said = new Map()
const log =
  tried(
    "log",
    "--format=%(trailers:key=Contract-Break,valueonly,separator=%x00)%x00",
    `${base}..HEAD`
  ) ?? ""
for (const line of log
  .split("\0")
  .map((l) => l.trim())
  .filter(Boolean)) {
  const [method, ...why] = line.split(",")
  said.set(method.trim(), why.join(",").trim())
}

const work = mkdtempSync(join(tmpdir(), "banda-contract-"))
try {
  const archive = execFileSync("git", ["archive", base, GENERATED])
  execFileSync("tar", ["-x", "-C", work], { input: archive })
  cpSync(join(work, GENERATED), join(work, "old"), { recursive: true })
  cpSync(GENERATED, join(work, "new"), { recursive: true })

  const meant =
    [...said.keys()].map((m) => JSON.stringify(m)).join(" | ") || "never"
  const checks = {
    gone: "Exclude<keyof Old, keyof New>",
    kind: `{ [M in Shared]: [New[M]["kind"]] extends [Old[M]["kind"]] ? never : M }[Shared]`,
    params: `{ [M in Shared]: [Old[M]["params"]] extends [New[M]["params"]] ? never : M }[Shared]`,
    answer: `{ [M in Shared]: [New[M]["answer"]] extends [Old[M]["answer"]] ? never : M }[Shared]`,
  }
  const names = Object.keys(checks)
  writeFileSync(
    join(work, "check.ts"),
    [
      `import type { Methods as Old } from "./old/Methods"`,
      `import type { Methods as New } from "./new/Methods"`,
      `type Meant = ${meant}`,
      `type Shared = keyof Old & keyof New`,
      `type Expect<T extends never> = T`,
      ...names.map(
        (name) =>
          `export type ${name} = Expect<Exclude<${checks[name]}, Meant>>`
      ),
      "",
    ].join("\n")
  )
  const tsc = join(
    dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
    "bin/tsc"
  )
  let output = ""
  try {
    execFileSync(
      process.execPath,
      [
        tsc,
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--target",
        "es2022",
        "--module",
        "esnext",
        "--moduleResolution",
        "bundler",
        "check.ts",
      ],
      { cwd: work, encoding: "utf8" }
    )
  } catch (error) {
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`
  }

  const why = {
    gone: "gone: a window of the last Dev calls it",
    kind: "another kind: a window of the last Dev sends it as it was",
    params:
      "takes less: a window of the last Dev sends what it took (a new required field, or a narrower type)",
    answer:
      "answers more: a window of the last Dev cannot read it (a field gone, or a wider type)",
  }
  const broken = []
  for (const line of output.split("\n")) {
    const at = line.match(/^check\.ts\((\d+),/)
    if (!at) continue
    const name = names[Number(at[1]) - 6]
    const methods = [...line.matchAll(/"([a-z_]+\.[a-z_.]+)"/g)].map(
      (m) => m[1]
    )
    if (!name || !methods.length) {
      broken.push(line)
      continue
    }
    for (const method of new Set(methods))
      broken.push(`${method}: ${why[name]}`)
  }
  if (output && !broken.length) {
    console.error(output)
    throw new Error("contract: TypeScript failed on the comparison itself")
  }
  for (const [method, what] of said) {
    console.log(
      `contract: ${method} breaks on purpose: ${what || "(no reason given)"}`
    )
  }
  if (broken.length) {
    console.error(
      `The contract breaks windows of ${base.slice(0, 9)} (ADR 0115, decision 6):`
    )
    for (const line of broken) console.error(`  ${line}`)
    console.error(
      "Keep the old method or field beside the new one, make the new field optional, or say the break\n" +
        "in a commit's trailer: Contract-Break: <method>, <what an older window does without it>"
    )
    process.exit(1)
  }
  console.log(
    `contract: the windows of ${base.slice(0, 9)} work with this engine`
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}
