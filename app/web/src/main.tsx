import "./renamed"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Engine } from "@banda/contract"
import "@banda/ui/globals.css"
import "./host"
import { followLook } from "./look"

const host = window.banda
// The look the desktop reads (ADR 0007), else the system's light or dark.
followLook(host)
const root = createRoot(document.getElementById("root")!)
// Both windows reach the engine.
const engine = host && new Engine(() => host.engine())

if (host && engine && location.hash.startsWith("#settings")) {
  // The settings window: the same page (ADR 0016), with the engine for
  // what only it knows, as who is signed in to each Harness.
  // Its title is how Hyprland and the Person's window list tell it apart.
  document.title = "Banda Settings"
  // Each window loads only its own part of the page.
  void import("./settings/Settings").then(({ Settings }) =>
    root.render(
      <StrictMode>
        <div className="h-svh">
          <Settings
            engine={engine}
            link={location.hash.replace(/^#settings\/?/, "")}
            onClose={() => host.settings.close()}
          />
        </div>
      </StrictMode>
    )
  )
} else if (engine) {
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
