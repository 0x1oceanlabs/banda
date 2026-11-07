// The licenses of what Banda ships (ADR 0038, decision 1): the crates the
// engine is built from, the npm packages the window and the page are, and
// the code vendored into the repository.
//
//   node scripts/licenses.mjs                  every license is one allowed
//   node scripts/licenses.mjs --notices FILE   and FILE gets their texts
//
// scripts/check.sh runs the first, scripts/package.sh the second, so the
// app carries the texts MIT, BSD and the like ask a copy to keep. Tests and
// build tools are not shipped and are not read. Electron and Chromium bring
// their own notices: electron-builder packs LICENSE.electron.txt and
// LICENSES.chromium.html beside the app.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

// Permissive, or MPL-2.0, which binds only its own files. Nothing that
// would bind Banda's code, as the GPL does. A new one is Roma's call.
const ALLOWED = new Set(
  [
    "0BSD",
    "Apache-2.0",
    "Apache-2.0 WITH LLVM-exception",
    "BlueOak-1.0.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSL-1.0",
    "CC0-1.0",
    "ISC",
    "MIT",
    "MPL-2.0",
    "OFL-1.1",
    // argparse, under js-yaml, under electron-updater (ADR 0041).
    "Python-2.0",
    "Unicode-3.0",
    "Unlicense",
    "Zlib",
  ].map((id) => id.toLowerCase())
)

// devDependencies the page's build reads in all the same: CSS that
// client/ui/src/styles/globals.css imports.
const BUNDLED_DEV = { "client/ui": ["tailwindcss", "shadcn"] }

// Code copied into the repository, which no package manager knows of
// (client/ghostty/README.md).
const VENDORED = [
  ["T3 Code's terminal adapter", "client/ghostty/LICENSE-T3"],
  ["Ghostty's libghostty-vt", "client/ghostty/native/LICENSE-GHOSTTY"],
  ["Symbols Nerd Font Mono", "client/ghostty/src/t3/fonts/LICENSE"],
].map(([name, file]) => ({
  name,
  version: "vendored",
  license: "MIT",
  files: [file],
}))

const args = process.argv.slice(2)
const notices = args[0] === "--notices" ? args[1] : undefined
if (args.length && !notices) throw new Error("licenses.mjs [--notices FILE]")

const run = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", maxBuffer: 1 << 28 })

/** Whether an SPDX expression lets Banda ship it: one side of an OR, both
 * of an AND. `X WITH Y` is one name; `MIT/Apache-2.0`, as old crates
 * write it, is an OR. */
function allowed(expression) {
  const tokens =
    expression
      .toLowerCase()
      .replace(/\//g, " or ")
      .match(/[()]|[^\s()]+(?:\s+with\s+[^\s()]+)?/g) ?? []
  let at = 0
  // Each side is read even when the other settles it, to move past it.
  const any = () => {
    let ok = all()
    while (tokens[at] === "or") {
      at++
      ok = all() || ok
    }
    return ok
  }
  const all = () => {
    let ok = one()
    while (tokens[at] === "and") {
      at++
      ok = one() && ok
    }
    return ok
  }
  const one = () => {
    if (tokens[at] !== "(") return ALLOWED.has(tokens[at++])
    at++
    const ok = any()
    at++
    return ok
  }
  return any() && at === tokens.length
}

/** The crates the banda binary is built from on this machine's platform:
 * normal dependencies, not tests' or build scripts'. */
function crates() {
  const host = run("rustc", ["-vV"]).match(/^host: (.+)$/m)[1]
  const metadata = JSON.parse(
    run("cargo", [
      "metadata",
      "--format-version=1",
      "--locked",
      `--filter-platform=${host}`,
    ])
  )
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]))
  const seen = new Set()
  const walk = (id) => {
    if (seen.has(id)) return
    seen.add(id)
    for (const dep of nodes.get(id).deps) {
      if (dep.dep_kinds.some((kind) => kind.kind === null)) walk(dep.pkg)
    }
  }
  walk(metadata.packages.find((p) => p.name === "banda" && !p.source).id)
  return metadata.packages
    .filter((p) => seen.has(p.id) && p.source !== null)
    .map((p) => ({ ...p, dir: dirname(p.manifest_path) }))
}

/** The npm packages the workspace's packages run on, and the few
 * devDependencies the build reads in. */
function npm() {
  const listed = Object.values(
    JSON.parse(
      run("pnpm", ["licenses", "list", "--json", "--recursive", "--prod"])
    )
  )
    .flat()
    .flatMap((p) =>
      p.versions.map((version, i) => ({ ...p, version, dir: p.paths[i] }))
    )
  const dev = Object.entries(BUNDLED_DEV).flatMap(([at, names]) =>
    names.map((name) => {
      const dir = join(at, "node_modules", name)
      return { ...JSON.parse(readFileSync(join(dir, "package.json"))), dir }
    })
  )
  return [...listed, ...dev]
}

// khroma 2.1.0, used by Mermaid, ships its MIT text but no manifest
// license field. Verify that exact text before supplying its metadata:
// https://github.com/fabiospampinato/khroma/blob/v2.1.0/license
const VERIFIED_TEXT = {
  "khroma@2.1.0": {
    license: "MIT",
    sha256: "66b333b0f66759a0b710459e03f7029abe17f4358114a128d2c972e642961b49",
  },
  // The Claude Agent SDK, under the Claude Code adapter, is under
  // Anthropic's own terms, not a license above: Roma decided Banda carries
  // it (ADR 0059), as T3 Code does. Each version's text is checked again.
  "@anthropic-ai/claude-agent-sdk@0.3.312": {
    license: "LicenseRef-Anthropic",
    sha256: "8ce94b9478bb9868f9641f818e06cd722fbe55d4c22e2d2ed11971b20146173a",
    decided: true,
  },
}

/** Whether one of `files` is exactly the text `sha256` names. */
const carries = (files, sha256) =>
  files.some(
    (file) =>
      createHash("sha256").update(readFileSync(file)).digest("hex") === sha256
  )

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([.-].*)?$/i
const shipped = [...crates(), ...npm()]
  .map(({ name, version, license, dir }) => ({
    name,
    version,
    license,
    files: readdirSync(dir)
      .filter((file) => LICENSE_FILE.test(file))
      .map((file) => join(dir, file)),
  }))
  .concat(VENDORED)
  .map((p) => {
    const verified = VERIFIED_TEXT[`${p.name}@${p.version}`]
    if (p.license !== "Unknown" || !verified) return p
    const { license, decided } = verified
    return carries(p.files, verified.sha256) ? { ...p, license, decided } : p
  })
  .sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
  )

const refused = shipped.filter((p) => !p.decided && !allowed(p.license ?? ""))
if (refused.length) {
  for (const p of refused) {
    console.error(`${p.name} ${p.version}: ${p.license ?? "no license"}`)
  }
  console.error(
    `licenses.mjs: ${refused.length} not allowed (ADR 0038, decision 1)`
  )
  process.exit(1)
}

if (notices) {
  // Many packages carry the same text, Apache-2.0's above all: each text is
  // written once, under every package that carries it.
  const byText = new Map()
  for (const p of shipped) {
    const texts = p.files.length
      ? p.files.map((file) => readFileSync(file, "utf8").trim())
      : [`${p.license}: the package carries no text of its license.`]
    for (const text of texts) {
      const key = text.replace(/\s+/g, " ")
      const entry = byText.get(key) ?? { text, names: new Set() }
      entry.names.add(`${p.name} ${p.version} (${p.license})`)
      byText.set(key, entry)
    }
  }
  const sections = [...byText.values()].map(
    ({ text, names }) => `${[...names].join("\n")}\n\n${text}`
  )
  writeFileSync(
    notices,
    "Banda includes the following, under these licenses.\n\n" +
      sections.join(`\n\n${"=".repeat(78)}\n\n`) +
      "\n"
  )
  console.log(`licenses.mjs: ${shipped.length} notices in ${notices}`)
} else {
  console.log(`licenses.mjs: ${shipped.length} shipped, every license allowed`)
}
