// The Node that Banda carries on Windows, which runs the ACP adapters there
// (ADR 0090, decision 5): node.exe of a pinned Node LTS release, never the
// installed app's Electron, which has no console and which Windows locks
// while it runs.
//
//   node scripts/node.mjs [win-x64|win-arm64]
//
// It downloads the release's node.exe from nodejs.org, and Node's LICENSE
// from the release's tag, into target/node/<platform>/, each checked
// against the SHA-256 pinned below; one already there as pinned is kept.
// There electron-builder.config.mjs packs node.exe as
// resources/node/node.exe, and scripts/licenses.mjs (--node) reads the
// license for the notices.
//
// node.exe's SHA-256s are those the release's SHASUMS256.txt lists, its
// signature checked against Node's release keys
// (github.com/nodejs/release-keys) when the version was pinned. A Node
// security release means a new pin here, and a new Banda release.
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const NODE_RELEASE = {
  version: "26.13.0",
  sha256: {
    "win-x64/node.exe":
      "14319838b3f355e0398c13569a90270bce4fc68f25189f58c59b03dadae0e6d5",
    "win-arm64/node.exe":
      "4c9baa047c4ae555050179f25a63153f1c962af32e2aad97735fb550750c5e7a",
    LICENSE: "8e603aa87c70d36e497004f0dec63111511cb61b7d65ace12e10ea791599286c",
  },
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex")

/** `url` in `file`, checked against `pinned`: the file there when it is
 * the one pinned, else downloaded again. */
async function fetched(url, file, pinned) {
  if (existsSync(file) && sha256(readFileSync(file)) === pinned) return
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`node.mjs: ${url} answered ${response.status}`)
  const data = Buffer.from(await response.arrayBuffer())
  if (sha256(data) !== pinned)
    throw new Error(
      `node.mjs: ${url} has SHA-256 ${sha256(data)}, not the ${pinned} pinned`
    )
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.part`, data)
  renameSync(`${file}.part`, file)
}

// Run, not imported, as scripts/licenses.mjs imports it.
if (import.meta.main) {
  const platform = process.argv[2] ?? "win-x64"
  const { version, sha256: pins } = NODE_RELEASE
  const program = `${platform}/node.exe`
  if (!pins[program])
    throw new Error(`node.mjs: no Node is pinned for ${platform}`)
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const folder = join(root, "target", "node", platform)
  await fetched(
    `https://nodejs.org/dist/v${version}/${program}`,
    join(folder, "node.exe"),
    pins[program]
  )
  await fetched(
    `https://raw.githubusercontent.com/nodejs/node/v${version}/LICENSE`,
    join(folder, "LICENSE"),
    pins.LICENSE
  )
  console.log(`node.mjs: Node ${version} for ${platform} in ${folder}`)
}
