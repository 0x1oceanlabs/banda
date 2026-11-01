/**
 * The desktop's side of the browser, on `window.banda.browser`
 * (app/desktop/src/preload.ts); none outside Banda's desktop window. Its
 * news goes to the pages and to the downloads here.
 */
import type { Actions, BrowserHost, BrowserNews, Download } from "./desktop"

export function browserHost(): BrowserHost | undefined {
  if (typeof window === "undefined") return undefined
  return (window as unknown as { banda?: { browser?: BrowserHost } }).banda
    ?.browser
}

/** Calls `listener` with the desktop's news; returns how to stop. */
export function hearNews(listener: (news: BrowserNews) => void): () => void {
  return browserHost()?.listen(listener) ?? (() => undefined)
}

/** This run's downloads, the latest last. */
let downloads: readonly Download[] = []
const watching = new Set<() => void>()

hearNews((news) => {
  if (news.kind !== "download") return
  const { download } = news
  const at = downloads.findIndex((each) => each.id === download.id)
  downloads = at < 0 ? [...downloads, download] : downloads.with(at, download)
  for (const each of watching) each()
})

/** Calls `changed` on each change of the downloads; returns how to stop. */
export function watchDownloads(changed: () => void): () => void {
  watching.add(changed)
  return () => watching.delete(changed)
}

export function downloadsNow(): readonly Download[] {
  return downloads
}

/** The extensions' buttons, while a Pane shows them. */
let actions: Actions = { actions: [] }
const watchingActions = new Set<() => void>()
let stopActions: (() => void) | undefined

let reading: Promise<void> | null = null
let again = false

/** Reads the buttons again, one read at a time: news during a read reads
 * once more after it. A read that changed nothing draws nothing. */
function readActions(): void {
  const host = browserHost()
  if (!host) return
  if (reading) {
    again = true
    return
  }
  reading = host.actions
    .state()
    .then(({ actions: now }) => {
      if (JSON.stringify(now) === JSON.stringify(actions.actions)) return
      actions = { actions: now }
      for (const each of watchingActions) each()
    })
    .catch(() => undefined)
    .finally(() => {
      reading = null
      if (!again) return
      again = false
      readActions()
    })
}

/** Calls `changed` on each change of the extensions' buttons; returns how
 * to stop. */
export function watchActions(changed: () => void): () => void {
  watchingActions.add(changed)
  if (!stopActions) {
    stopActions = browserHost()?.actions.listen(readActions)
    readActions()
  }
  return () => {
    watchingActions.delete(changed)
    if (watchingActions.size) return
    stopActions?.()
    stopActions = undefined
  }
}

export function actionsNow(): Actions {
  return actions
}
