import react from "@astrojs/react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"

// banda.so (ADR 0128): static pages, drawn with Banda UI. React renders
// @banda/ui's components to HTML at build; a page ships a component's JS
// only where it marks it `client:*`.
export default defineConfig({
  site: "https://banda.so",
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
})
