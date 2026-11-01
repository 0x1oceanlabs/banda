import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The desktop loads the built page from app://banda, so every path is
// relative; in development it loads the dev server instead.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  // The page loads from disk, so one large chunk costs nothing to fetch.
  build: { target: "es2023", chunkSizeWarningLimit: 2048 },
  server: { port: 5173, strictPort: true },
})
