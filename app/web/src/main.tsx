import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Engine } from "@bandaso/contract"
import "@bandaso/ui/globals.css"
import { App } from "./App"
import "./host"
import { followLook } from "./look"

const host = window.bandaso
// The look the desktop reads (ADR 0007), else the system's light or dark.
followLook(host)
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
