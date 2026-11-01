/**
 * The desktop's side of the browser, on `window.banda.browser`
 * (app/desktop/src/preload.ts); none outside Banda's desktop window. It
 * tells the pages' news to whoever listens: the pages, and the downloads.
 */
import type { BrowserHost, BrowserNews, Download } from "./desktop"

export function browserHost(): BrowserHost | undefined {
  if (typeof window === "undefined") return undefined
  return (window as unknown as { banda?: { browser?: BrowserHost } }).banda
    ?.browser
}

let heard = false
const listeners = new Set<(news: BrowserNews) => void>()

/** Calls `listener` with the desktop's news; returns how to stop. */
export function hearNews(listener: (news: BrowserNews) => void): () => void {
  if (!heard) {
    heard = true
    browserHost()?.listen((news) => {
      for (const each of listeners) each(news)
    })
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
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
