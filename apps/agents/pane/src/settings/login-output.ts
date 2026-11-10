/** The provider's terminal text and HTTPS links, without ANSI formatting. */
export function loginOutput(output: string): { text: string; links: string[] } {
  const text = output
    // eslint-disable-next-line no-control-regex -- OSC hyperlinks and terminal titles
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    // eslint-disable-next-line no-control-regex -- terminal colour and cursor controls
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
  const links = [...new Set(text.match(/https:\/\/[^\s<>]+/g) ?? [])].filter(
    (link) => {
      try {
        return new URL(link).protocol === "https:"
      } catch {
        return false
      }
    }
  )
  return { text, links }
}
