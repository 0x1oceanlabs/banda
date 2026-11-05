/**
 * The address a Person types, and the one the row shows (ADR 0013,
 * decision 4): the row shows only the site; what is typed is an address
 * when it reads as one, and words for the search otherwise.
 */

import { useCallback } from "react"
import { BROWSER_FILE, DEFAULT_BROWSER } from "@banda/contract/browser"
import { fileNow, useFile } from "@banda/ui/lib/look"
import { siteOf } from "./desktop"

export { siteOf }

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

/** The search for `words` that `browser.toml` names now, even words that
 * read as an address: a Thread's "Search the web" (ADR 0063, decision 3). */
export function searchNow(words: string): string {
  const { search } = fileNow(BROWSER_FILE)
  return search.replace("%s", encodeURIComponent(words.trim()))
}

/** {@link addressOf} with the search `browser.toml` names now. */
export function useAddressOf(): (typed: string) => string {
  const { search } = useFile(BROWSER_FILE)
  return useCallback((typed: string) => addressOf(typed, search), [search])
}

/** The page of the file at the absolute `path`. */
export { fileUrl as fileAddress } from "@banda/ui/lib/file-links"

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
