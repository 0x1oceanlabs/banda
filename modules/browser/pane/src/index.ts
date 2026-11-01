/** The browser's Pane (ADR 0013). */
import { browserPane } from "./BrowserPane"

export { browserPane }
export { fileAddress, isAddress, useAddressOf } from "./address"
export { type BrowserArgs, browserAt, NEW_BROWSER, type Tab } from "./tabs"

export const panes = [browserPane]
