// The Node that Banda carries, which runs the ACP adapters where no Electron
// does: the Windows app's (ADR 0090, decision 5), never the installed app's
// Electron, which has no console and which Windows locks while it runs;
// and the engine bundle's on Linux and macOS (ADR 0119, step 1b), for a
// machine with no window, as a server is.
//
//   node scripts/node.mjs [win-x64|win-arm64|linux-x64|darwin-arm64]
//
// It downloads a pinned Node release from nodejs.org, and Node's LICENSE
// from the release's tag, into target/node/<platform>/, each checked
// against the SHA-256 pinned below; one already there as pinned is kept.
// - Windows: node.exe, which electron-builder.config.mjs packs as
//   resources/node/node.exe.
// - Linux and macOS: the release's tarball, whose bin/node is taken out as
//   node/node, which scripts/engine.mjs puts in the engine bundle as it is
//   (platform/harnesses' carried::NODE_FOLDER).
// scripts/licenses.mjs (--node) reads the license for the notices.
//
// The SHA-256s are those the release's SHASUMS256.txt lists, its
// signature checked against Node's release keys
// (github.com/nodejs/release-keys) when the version was pinned:
//
//   gpg --import release-keys/keys/*.asc
//   gpg --verify SHASUMS256.txt.sig SHASUMS256.txt
//
// 26.13.0's is signed by C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C, in
// release-keys' keys.list (checked 2026-11-12, release-keys at 481637f).
// A Node security release means a new pin here, and a new Banda release.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
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
    "node-v26.13.0-linux-x64.tar.gz":
      "5848553868b402d3fabb5b09270649977780a390f832155721025a08b5104455",
    "node-v26.13.0-darwin-arm64.tar.gz":
      "d38bd5e5a2ddce6bbb5ce45e46e208337da4d51fffe611e567fd32073d6439f6",
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
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const folder = join(root, "target", "node", platform)
  const exe = `${platform}/node.exe`
  const tarball = `node-v${version}-${platform}.tar.gz`
  if (pins[exe]) {
    await fetched(
      `https://nodejs.org/dist/v${version}/${exe}`,
      join(folder, "node.exe"),
      pins[exe]
    )
  } else if (pins[tarball]) {
    await fetched(
      `https://nodejs.org/dist/v${version}/${tarball}`,
      join(folder, tarball),
      pins[tarball]
    )
    // Its bin/node alone, as node/node: tar takes it out as it is, its
    // mode too, on GNU's tar and macOS's.
    rmSync(join(folder, "node"), { recursive: true, force: true })
    mkdirSync(join(folder, "node"))
    execFileSync("tar", [
      "-xzf",
      join(folder, tarball),
      "-C",
      join(folder, "node"),
      "--strip-components=2",
      `node-v${version}-${platform}/bin/node`,
    ])
  } else {
    throw new Error(`node.mjs: no Node is pinned for ${platform}`)
  }
  await fetched(
    `https://raw.githubusercontent.com/nodejs/node/v${version}/LICENSE`,
    join(folder, "LICENSE"),
    pins.LICENSE
  )
  console.log(`node.mjs: Node ${version} for ${platform} in ${folder}`)
}
