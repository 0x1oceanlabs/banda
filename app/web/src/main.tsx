import "./renamed"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Engine } from "@banda/contract"
import "@banda/ui/globals.css"
import "./host"
import { moveEnterKey } from "./enter-key"
import { followLook } from "./look"

const host = window.banda
// The look the desktop reads (ADR 0007), else the system's light or dark.
followLook(host)
const root = createRoot(document.getElementById("root")!)
const engine = host && new Engine(() => host.engine())

if (host && engine) {
  void moveEnterKey(host).catch(() => undefined)
  void import("./App").then(({ App }) =>
    root.render(
      <StrictMode>
        <App engine={engine} />
      </StrictMode>
    )
  )
} else {
  root.render(
    <p className="p-6 text-sm text-muted-foreground">
      Open Banda from its desktop app: this page needs it to reach the engine.
    </p>
  )
}
