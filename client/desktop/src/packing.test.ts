/**
 * What the packed app carries (`electron-builder.config.mjs`, ADR 0033):
 * the ACP adapters the harnesses' host package builds, as
 * `resources/adapters` beside the engine, where the engine looks for them
 * and the engine's own copy takes them from (ADR 0059; program.ts). On
 * Windows also the Node they run on there, which scripts/node.mjs
 * downloads from a pinned Node release (ADR 0090, decision 5), and the
 * engine's line tables.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, expect, test, vi } from "vitest"
import { CARRIED, ELECTRON, NODE_FOLDER } from "./program"

const root = resolve(import.meta.dirname, "../../..")
const text = (path: string) => readFileSync(resolve(root, path), "utf8")

afterEach(() => vi.unstubAllEnvs())

type Resource = { from: string; to: string }
type Config = {
  extraResources: Resource[]
  linux: { extraResources: Resource[] }
  mac: { extraResources: Resource[] }
  win: {
    target: { target: string; arch: string[] }[]
    extraResources: Resource[]
  }
  nsis: Record<string, unknown>
  publish: { channel?: string } | null
}

/** The config, as electron-builder reads it; its file has no types. */
async function config(): Promise<Config> {
  vi.stubEnv("BANDA_VERSION", "0.0.0-test")
  const file = "../electron-builder.config.mjs"
  return ((await import(/* @vite-ignore */ file)) as { default: Config })
    .default
}

test("the app carries the harnesses' host package's adapters beside its engine", async () => {
  expect((await config()).extraResources).toContainEqual({
    from: "../../platform/harnesses/adapters/dist",
    to: CARRIED,
  })
  // The window's build builds them first, as scripts/package.sh runs it
  // before electron-builder; the host package builds them into dist/.
  expect(text("client/desktop/build.mjs")).toContain(
    'import "../../platform/harnesses/adapters/build.mjs"'
  )
  expect(text("platform/harnesses/adapters/build.mjs")).toContain(
    'join(here, "dist")'
  )
  expect(text("pnpm-workspace.yaml")).toContain(
    "  - platform/harnesses/adapters\n"
  )
  // The folder the engine looks for beside its program, and the file
  // beside its copy that names the app's Electron.
  const carried = text("platform/harnesses/engine/src/carried.rs")
  expect(carried).toContain(`pub const FOLDER: &str = "${CARRIED}";`)
  expect(carried).toContain(`pub const ELECTRON: &str = "${ELECTRON}";`)
  expect(carried).toContain(`pub const NODE_FOLDER: &str = "${NODE_FOLDER}";`)
})

test("each system's app carries its own engine, and Windows' its line tables and Node", async () => {
  const { linux, mac, win } = await config()
  const engine = { from: "../../target/release/banda", to: "banda" }
  expect(linux.extraResources).toContainEqual(engine)
  expect(mac.extraResources).toContainEqual(engine)
  expect(win.extraResources).toEqual([
    { from: "../../target/release/banda.exe", to: "banda.exe" },
    { from: "../../target/release/banda.pdb", to: "banda.pdb" },
    // Where scripts/node.mjs downloads it to, for each arch.
    {
      from: "../../target/node/win-${arch}/node.exe",
      to: `${NODE_FOLDER}/node.exe`,
    },
  ])
  expect(win.target).toEqual([{ target: "nsis", arch: ["x64"] }])
})

test("Windows' installer is per user, never elevates, and has Banda's own part", async () => {
  expect((await config()).nsis).toMatchObject({
    oneClick: true,
    perMachine: false,
    packElevateHelper: false,
    include: "installer.nsh",
  })
})

test("the Node Windows' app carries is pinned for each arch it is built for", async () => {
  const file = pathToFileURL(resolve(root, "scripts/node.mjs")).href
  const { NODE_RELEASE } = (await import(/* @vite-ignore */ file)) as {
    NODE_RELEASE: { sha256: Record<string, string> }
  }
  const { win } = await config()
  for (const arch of win.target.flatMap((target) => target.arch))
    expect(NODE_RELEASE.sha256[`win-${arch}/node.exe`]).toMatch(
      /^[0-9a-f]{64}$/
    )
})

test("each app's update file has a name of its own, which the release workflow publishes (ADR 0092)", async () => {
  const publish = async (channel: string) => {
    vi.stubEnv("BANDA_CHANNEL", channel)
    vi.resetModules()
    return (await config()).publish
  }
  // Banda Dev's is dev-linux.yml, dev-mac.yml or dev.yml; Banda's keeps
  // electron-builder's latest-…; Banda Local has none.
  const github = { provider: "github", owner: "0x1oceanlabs", repo: "banda" }
  expect(await publish("dev")).toEqual({ ...github, channel: "dev" })
  expect(await publish("stable")).toEqual(github)
  expect(await publish("local")).toBeNull()
  const release = text(".github/workflows/release.yml")
  expect(release).toContain("client/desktop/dist/*-linux.yml")
  expect(release).toContain('"$MAC"/*-mac.yml')
  expect(release).toContain("client/desktop/dist/$feed.yml windows/")
  expect(release).not.toMatch(/dist\/latest-(linux|mac)\.yml/)
})
