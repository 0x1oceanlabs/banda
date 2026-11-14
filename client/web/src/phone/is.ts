/**
 * The phone's form of the window (ADR 0124, SE6; what we build, "the
 * phone's first version"): the same window, in a browser as narrow as a
 * phone. Its home is the list, the sidebar as it is, the whole screen
 * wide; a Thread, or a Pane opened from one, is the whole screen, one at
 * a time, with a way back in its header (`back.tsx`). It has no bar and
 * no Tiling to work: the Window places the Panes as ever, and the phone
 * shows the one with the focus.
 *
 * A phone is a browser, not Banda's app: a narrow window of the desktop
 * keeps the desktop's form, as its Person tiles it so.
 */
import { useSyncExternalStore } from "react"
import { device } from "../boot"
import { focused, type Workspaces } from "../tiling/model"

/** As wide as a phone held upright, and no wider. */
const NARROW = "(max-width: 30rem)"

const narrow = () => matchMedia(NARROW)

/** What only Banda's app does for a Pane: a browser does not. */
const inBrowser = () => !device.has("webview")

/** Whether the window has the phone's form now. */
export const phoneNow = (): boolean => inBrowser() && narrow().matches

const follow = (changed: () => void) => {
  const media = narrow()
  media.addEventListener("change", changed)
  return () => media.removeEventListener("change", changed)
}

/** Whether the window has the phone's form, as it changes: a phone
 * turned on its side is wider. */
export const usePhone = (): boolean =>
  useSyncExternalStore(follow, phoneNow, () => false)

/** Whether a phone has no Pane to show: its list is then all there is,
 * and shows whatever was asked. */
export const bare = (workspaces: Workspaces): boolean =>
  phoneNow() && focused(workspaces) === undefined
