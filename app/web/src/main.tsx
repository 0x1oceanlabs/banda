import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Engine } from "@bandaso/contract"
import "@bandaso/ui/globals.css"
import { App } from "./App"
import "./host"

// The window follows the system's light or dark.
const dark = matchMedia("(prefers-color-scheme: dark)")
const paint = () =>
  document.documentElement.classList.toggle("dark", dark.matches)
paint()
dark.addEventListener("change", paint)

const host = window.bandaso
const root = createRoot(document.getElementById("root")!)

if (host) {
  const engine = new Engine(() => host.engine())
  root.render(
    <StrictMode>
      <App engine={engine} />
    </StrictMode>
  )
} else {
  root.render(
    <p className="p-6 text-sm text-muted-foreground">
      Open Bandaso from its desktop app: this page needs it to reach the engine.
    </p>
  )
}
