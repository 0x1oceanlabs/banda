/**
 * The address a Person types, and the one the row shows (ADR 0013,
 * decision 4): the row shows only the site; what is typed is an address
 * when it reads as one, and words for the search otherwise.
 */

import { useCallback } from "react"
import { BROWSER_FILE, DEFAULT_BROWSER } from "@banda/contract/browser"
import { useFile } from "@banda/ui/lib/look"

const LOCAL =
  /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#]|$)/i
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]|$)/i

/** The page to open for what the Person typed; words go to `search`,
 * an address with `%s` where they go, as `browser.toml` says. */
export function addressOf(
  typed: string,
  search = DEFAULT_BROWSER.search
): string {
  const text = typed.trim()
  return pageAddress(text) ?? search.replace("%s", encodeURIComponent(text))
}

/** {@link addressOf} with the search `browser.toml` names now. */
export function useAddressOf(): (typed: string) => string {
  const { search } = useFile(BROWSER_FILE)
  return useCallback((typed: string) => addressOf(typed, search), [search])
}

/** The page of the file at the absolute `path`. */
export function fileAddress(path: string): string {
  return `file://${path.split("/").map(encodeURIComponent).join("/")}`
}

/** Whether what the Person typed reads as an address, not words. */
export function isAddress(typed: string): boolean {
  return pageAddress(typed.trim()) !== undefined
}

function pageAddress(text: string): string | undefined {
  if (/^(https?|file|about|data|blob):/i.test(text)) return text
  if (LOCAL.test(text)) return `http://${text}`
  if (!/\s/.test(text) && HOST.test(text)) return `https://${text}`
  return undefined
}

/** What the row shows of a page's address: its site, without `www.`. */
export function siteOf(address: string): string {
  try {
    const url = new URL(address)
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.host.replace(/^www\./, "")
    }
    if (url.protocol === "about:") return address
    return url.protocol === "file:"
      ? decodeURIComponent(url.pathname.split("/").pop() || url.pathname)
      : url.protocol.slice(0, -1)
  } catch {
    return address
  }
}
