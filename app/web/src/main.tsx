import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Engine } from "@banda/contract"
import "@banda/ui/globals.css"
import { App } from "./App"
import "./host"
import { followLook } from "./look"

const host = window.banda
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
      Open Banda from its desktop app: this page needs it to reach the engine.
    </p>
  )
}
