/**
 * What Banda's hands do in a page, for whoever holds one: the driver
 * here, and the browser's part in the window's main process. It loads no
 * Playwright and no Electron: its holder gives the page, its dialogs, its
 * keyboard and how its picture is bounded.
 */
export {
  BYTES,
  captured,
  dialogOpen,
  EDGE,
  type Image,
  picture,
  sameAddress,
} from "./capture"
export { type Dialogs, unanswerable, waitsFor } from "./dialogs"
export {
  act,
  comboOf,
  type Keyboard,
  type Modifier,
  type Pointing,
  timedOut,
  waitFor,
} from "./hands"
export {
  ANSWERING,
  during,
  go,
  HISTORY,
  type History,
  LOADING,
  read,
  SETTLING,
  shown,
} from "./page"
export { noTab, Refusal } from "./refusal"
