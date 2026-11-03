import "./renamed"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Engine } from "@banda/contract"
import "@banda/ui/globals.css"
import { poppedOf } from "./host"
import { moveEnterKey } from "./enter-key"
import { followLook } from "./look"

const host = window.banda
// The look the desktop reads (ADR 0007), else the system's light or dark.
followLook(host)
const root = createRoot(document.getElementById("root")!)
const engine = host && new Engine(() => host.engine())

if (host && engine) {
  void moveEnterKey(host).catch(() => undefined)
  // A Pane in a window of its own draws alone (ADR 0025, decision 9).
  const popped = poppedOf(location.hash)
  const view = popped
    ? import("./workspaces/Popped").then(({ Popped }) => (
        <Popped engine={engine} host={host} pane={popped} />
      ))
    : import("./App").then(({ App }) => <App engine={engine} />)
  void view.then((shown) => root.render(<StrictMode>{shown}</StrictMode>))
} else {
  root.render(
    <p className="p-6 text-sm text-muted-foreground">
      Open Banda from its desktop app: this page needs it to reach the engine.
    </p>
  )
}
