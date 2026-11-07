// Bundles the ACP adapters for Claude Code and Codex into one file each,
// in dist/, which the engine runs on the Node its host provides (ADR 0059,
// decision 1; ADR 0062, S1): a packed app carries them as
// resources/adapters, and a checkout's engine finds them here. Their
// versions are this package's dependencies, and the engine's `known()`
// names the same; each file is its package's name. `pnpm build` runs
// this, and client/desktop/build.mjs on import. Codex's adapter is
// patched in patches/ (pnpm's `patchedDependencies`, in
// pnpm-workspace.yaml); Claude Code's takes the SDK through Banda's shim
// below.
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, "dist")
const require = createRequire(import.meta.url)

// Claude Code's adapter takes the Agent SDK through Banda's shim, which
// keeps its sessions in the Project's folder (claude-sdk.mjs, ADR 0078);
// the shim itself reaches the SDK as `banda:claude-agent-sdk`.
const shim = (manifest) => ({
  name: "banda-claude-sessions",
  setup(build) {
    const sdk = createRequire(manifest).resolve(
      "@anthropic-ai/claude-agent-sdk"
    )
    build.onResolve({ filter: /^@anthropic-ai\/claude-agent-sdk$/ }, () => ({
      path: join(here, "claude-sdk.mjs"),
    }))
    build.onResolve({ filter: /^banda:claude-agent-sdk$/ }, () => ({
      path: sdk,
    }))
  },
})

await Promise.all(
  [
    "@agentclientprotocol/claude-agent-acp",
    "@agentclientprotocol/codex-acp",
  ].map((name) => {
    const manifest = require.resolve(`${name}/package.json`)
    const { bin } = require(manifest)
    return build({
      entryPoints: [join(dirname(manifest), Object.values(bin)[0])],
      outfile: join(out, `${name.split("/")[1]}.mjs`),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      minify: true,
      logLevel: "warning",
      // CommonJS packages bundled in require Node's modules: an ES module
      // has no `require` of its own.
      banner: {
        js: 'import { createRequire as bandaRequire } from "node:module"; const require = bandaRequire(import.meta.url);',
      },
      plugins: name.endsWith("/claude-agent-acp") ? [shim(manifest)] : [],
    })
  })
)
