/**
 * The address a Person types, and the one the row shows (ADR 0013,
 * decision 4): the row shows only the site; what is typed is an address
 * when it reads as one, and words for the search otherwise.
 */

/** DuckDuckGo, until `browser.toml` names another; `%s` is the words. */
const SEARCH = "https://duckduckgo.com/?q=%s"

const LOCAL =
  /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#]|$)/i
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]|$)/i

/** The page to open for what the Person typed. */
export function addressOf(typed: string): string {
  const text = typed.trim()
  if (/^(https?|file|about|data|blob):/i.test(text)) return text
  if (LOCAL.test(text)) return `http://${text}`
  if (!/\s/.test(text) && HOST.test(text)) {
    return `https://${text}`
  }
  return SEARCH.replace("%s", encodeURIComponent(text))
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
