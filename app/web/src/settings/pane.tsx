/**
 * The settings Pane (ADR 0016, decision 1): a Pane of the window's own,
 * opened as any Pane is. Its args keep where it is, so it comes back
 * there. It loads with its first opening, not with the window.
 */
import { lazy, Suspense } from "react"
import { Spinner } from "@banda/ui/components/spinner"
import { definePane } from "@banda/ui/pane"
import { SettingsIcon } from "lucide-react"

/** Where the Pane is: a section and a row, `appearance/radius`. */
export type SettingsArgs = { link: string }

const Settings = lazy(() =>
  import("./Settings").then(({ Settings }) => ({ default: Settings }))
)

export const settingsPane = definePane<SettingsArgs>({
  kind: "window.settings",
  title: () => "Settings",
  icon: SettingsIcon,
  // Its own header says where it is, and closes it.
  header: false,
  Pane: (props) => (
    <Suspense fallback={<Spinner className="m-6" />}>
      <Settings {...props} />
    </Suspense>
  ),
})
