import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { execFile } from "node:child_process"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"
import { defineConfig, type Plugin } from "vite"

/**
 * The built page's maps, beside its scripts and named by none of them,
 * keep where each place of a script is in Banda's source, and not the
 * source itself: the page reads them as it keeps a Problem (ADR 0039,
 * decision 9).
 */
function placesOnly(): Plugin {
  return {
    name: "banda:maps-places-only",
    apply: "build",
    // Once written: the maps rolldown hands its plugins are copies.
    writeBundle({ dir }, bundle) {
      for (const name of Object.keys(bundle)) {
        if (!dir || !name.endsWith(".map")) continue
        const file = join(dir, name)
        const map = JSON.parse(readFileSync(file, "utf8"))
        delete map.sourcesContent
        writeFileSync(file, JSON.stringify(map))
      }
    },
  }
}

/**
 * The engine's model of the workspaces as the page runs it (ADR 0088,
 * decision 11): `platform/tiling/wasm`, built for WebAssembly as the
 * module is first asked for, and handed over as base64 text, so the page,
 * a test and a browser load it the same way, with no fetch. Cargo builds
 * only what changed, and says where it wrote the file. A change to the
 * model's source builds it again in a server that stays.
 */
function tilingModel(): Plugin {
  const id = "virtual:banda/tiling-model"
  const root = join(import.meta.dirname, "../..")
  const source = join(root, "platform/tiling")
  return {
    name: "banda:tiling-model",
    resolveId: (asked) => (asked === id ? `\0${id}` : undefined),
    async load(loaded) {
      if (loaded !== `\0${id}`) return undefined
      for (const name of readdirSync(source, { recursive: true }))
        if (/\.(rs|toml)$/.test(String(name)))
          this.addWatchFile(join(source, String(name)))
      // Cargo's warnings stay unsaid; what a failed build said is in the
      // error this throws.
      const { stdout } = await promisify(execFile)(
        "cargo",
        [
          "build",
          "--quiet",
          "--package=banda-tiling-wasm",
          "--target=wasm32-unknown-unknown",
          "--profile=wasm",
          "--message-format=json",
        ],
        { cwd: root, maxBuffer: 64 * 1024 * 1024 }
      )
      const built = stdout
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .flatMap((line) => {
          const said = JSON.parse(line) as { filenames?: string[] }
          return said.filenames ?? []
        })
        .find((file) => file.endsWith("banda_tiling_wasm.wasm"))
      if (!built) throw new Error("cargo built no banda_tiling_wasm.wasm")
      const bytes = readFileSync(built).toString("base64")
      return `export default ${JSON.stringify(bytes)}`
    },
  }
}

// The desktop loads the built page from app://banda, so every path is
// relative; in development it loads the dev server instead.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), placesOnly(), tilingModel()],
  // One React for the page, whichever package asks for it: `@banda/core`
  // has it as a peer, and a second copy would give each its own contexts
  // and hooks (ADR 0089).
  resolve: { dedupe: ["react", "react-dom"] },
  // The page loads from disk, so one large chunk costs nothing to fetch.
  build: {
    target: "es2023",
    chunkSizeWarningLimit: 2048,
    sourcemap: "hidden",
  },
  server: { port: 5173, strictPort: true },
})
