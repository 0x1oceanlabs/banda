import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
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

// The desktop loads the built page from app://banda, so every path is
// relative; in development it loads the dev server instead.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), placesOnly()],
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
