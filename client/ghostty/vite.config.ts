import { defineConfig } from "vite"

// Ghostty's WebAssembly is an asset: the adapter imports it by URL.
export default defineConfig({
  assetsInclude: ["**/*.wasm"],
})
