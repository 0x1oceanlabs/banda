import "./renamed"
import { readSignsFrom } from "@banda/ui/lib/signs"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Engine } from "@banda/contract"
import "@banda/ui/globals.css"
import { HostsContext, KeptHosts } from "./calls/hosts"
import { poppedOf } from "./host"
import { moveEnterKey } from "./enter-key"
import { followAccent } from "./accent"
import { followFrame } from "./frame"
import { followLook } from "./look"
import { keepProblem, watchProblems } from "./problems/keep"
import { type Broke, BrokeCard } from "./safe/Broke"
import { OFFER_AFTER, starting } from "./safe/starts"
import { device } from "./window/device"

const host = window.banda
// The look the desktop reads (ADR 0007), else the system's light or dark.
followLook(host)
followFrame(host)
followAccent(host)
const engine = host && new Engine(() => host.engine())
/** What broke in the page is a Problem (ADR 0039); React says it on the
 * console as it would. */
const kept = (error: unknown) => {
  console.error(error)
  keepProblem(error)
}
const root = createRoot(document.getElementById("root")!, {
  // What an error boundary caught, as a Pane that broke.
  onCaughtError: kept,
  // What none caught takes the window down: it says so, and how to go on,
  // rather than leave an empty window.
  onUncaughtError: (error) => {
    kept(error)
    broke({ what: "page", said: String(error) })
  },
})

if (host && engine) {
  watchProblems(engine)
  readSignsFrom(engine)
  void moveEnterKey(host).catch(() => undefined)
  // A Pane in a window of its own draws alone (ADR 0025, decision 9).
  const popped = poppedOf(location.hash)
  const show = () => {
    const view = popped
      ? import("./window/Popped").then(({ Popped }) => {
          // A Pane on another host reaches it from here too (ADR 0081),
          // for the window's life.
          const hosts = new KeptHosts(device.hosts)
          hosts.follow()
          return (
            <HostsContext value={hosts}>
              <Popped engine={engine} pane={popped} />
            </HostsContext>
          )
        })
      : import("./App").then(({ App }) => <App engine={engine} />)
    void view.then((shown) => root.render(<StrictMode>{shown}</StrictMode>))
  }
  // The main window counts its starts; after two that broke, it asks.
  if (!popped && starting() >= OFFER_AFTER)
    root.render(
      <BrokeCard engine={engine} broke={{ what: "starts" }} onOpen={show} />
    )
  else show()
} else {
  root.render(
    <p className="p-6 text-sm text-muted-foreground">
      Open Banda from its desktop app: this page needs it to reach the engine.
    </p>
  )
}

/** Says what broke, in place of the window (ADR 0039, decision 2), once
 * React has let go of the one that broke. */
function broke(what: Broke) {
  if (!host || !engine) return
  setTimeout(() =>
    root.render(
      <BrokeCard
        engine={engine}
        broke={what}
        onOpen={() => void host.problems.reopen()}
      />
    )
  )
}
