// Packs the engine alone beside the app scripts/package.sh packed (ADR
// 0119, decision 5): what a machine needs to run Banda's engine with no
// window and no Electron, as a server does, and what each machine's engine
// takes to update itself.
//
//   node scripts/engine.mjs <resources>
//
// <resources> is the packed app's, where the engine and what it carries
// are. It writes, in client/desktop/dist/:
//
// - <folder>-<version>-engine-<os>-<arch>.tar.gz: `banda` and its updater
//   `banda-update` (ADR 0131), its line tables
//   on macOS (`banda.dSYM`), the ACP adapters (`adapters/`), the window's
//   page it serves at its door (`web/dist/`, ADR 0124, with no source
//   maps), the Node the adapters run on (`node/node`, ADR 0119 step 1b:
//   scripts/node.mjs put it in target/node/<platform>/) and the licenses,
//   laid out as the engine's
//   own copy is (client/desktop/src/program.ts), so its files go into
//   <data>/engine/<version>/ as they are;
// - <feed>-engine-<os>.yml, beside the app's own (dev-linux.yml): the
//   version, and the file's size and sha512, as electron-builder writes
//   them. Banda Local writes none, as it never updates.
//
// BANDA_CHANNEL and BANDA_VERSION are scripts/package.sh's. A gzip'd tar,
// as every machine opens one with what it has.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join, resolve } from "node:path"

import { CHANNELS } from "../client/desktop/src/channel.ts"
import { NODE_RELEASE } from "./node.mjs"

const [resources] = process.argv.slice(2)
const which = process.env.BANDA_CHANNEL ?? "local"
const version = process.env.BANDA_VERSION
const channel = CHANNELS[which]
if (!resources || !version || !channel) {
  throw new Error(
    "BANDA_CHANNEL=<channel> BANDA_VERSION=<version> engine.mjs <resources>"
  )
}

const os = { linux: "linux", darwin: "mac" }[process.platform]
const arch = { x64: "x86_64", arm64: "arm64" }[process.arch]
if (!os || !arch)
  throw new Error(`no engine bundle for ${process.platform} ${process.arch}`)

// What the engine's own copy carries, and the licenses it is shipped under
// (ADR 0038). Each must be there: a bundle without one would update a
// machine into an engine that cannot run its Agents.
const carried = [
  "banda",
  "banda-update",
  ...(os === "mac" ? ["banda.dSYM"] : []),
  "adapters",
  "web",
  "LICENSE",
  "NOTICE",
  "THIRD-PARTY-NOTICES.txt",
]
for (const name of carried) {
  if (!existsSync(join(resources, name))) {
    throw new Error(`engine.mjs: ${resources} has no ${name}`)
  }
}

// The Node the adapters run on with no Electron beside them, where
// platform/harnesses' carried.rs looks: `node/node` beside the engine.
const platform = `${process.platform}-${process.arch}`
// Whole, as tar takes a second -C from where the first left it.
const nodes = resolve("target", "node", platform)
const node = execFileSync(join(nodes, "node", "node"), ["--version"], {
  encoding: "utf8",
}).trim()
if (node !== `v${NODE_RELEASE.version}`) {
  throw new Error(
    `engine.mjs: ${nodes}/node/node says ${node}, not the v${NODE_RELEASE.version} pinned; run node scripts/node.mjs ${platform}`
  )
}

// The engine says the version it was built as, or it is not this one.
const said = execFileSync(join(resources, "banda"), ["--version"], {
  encoding: "utf8",
}).trim()
if (!said.startsWith(`banda ${version} `)) {
  throw new Error(`engine.mjs: the engine says "${said}", not ${version}`)
}
// And so does its updater (ADR 0131).
const updater = execFileSync(join(resources, "banda-update"), ["--version"], {
  encoding: "utf8",
}).trim()
if (updater !== `banda-update ${version}`) {
  throw new Error(`engine.mjs: banda-update says "${updater}", not ${version}`)
}

const dist = "client/desktop/dist"
const name = `${channel.folder}-${version}-engine-${os}-${arch}.tar.gz`
const file = join(dist, name)
rmSync(file, { force: true })
execFileSync(
  "tar",
  [
    "-czf",
    file,
    // The page's source maps stay with the app: a machine with no window
    // reads none.
    "--exclude=web/dist/assets/*.map",
    "-C",
    resources,
    ...carried,
    "-C",
    nodes,
    "node/node",
  ],
  { stdio: "inherit" }
)

const listed = execFileSync("tar", ["-tzf", file], { encoding: "utf8" })
  .split("\n")
  .map((entry) => entry.replace(/^\.\//, ""))
for (const name of [
  "banda",
  "banda-update",
  "adapters/claude-agent-acp.mjs",
  "adapters/codex-acp.mjs",
  "web/dist/index.html",
  "node/node",
]) {
  if (!listed.includes(name))
    throw new Error(`engine.mjs: ${file} has no ${name}`)
}

const size = statSync(file).size
console.log(`${name}, ${(size / 2 ** 20).toFixed(0)} MB`)
if (which === "local") process.exit(0)

const sha512 = createHash("sha512").update(readFileSync(file)).digest("base64")
const feed = `${which === "dev" ? "dev" : "latest"}-engine-${os}.yml`
writeFileSync(
  join(dist, feed),
  [
    `version: ${version}`,
    "files:",
    `  - url: ${name}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${name}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    "",
  ].join("\n")
)
console.log(feed)
