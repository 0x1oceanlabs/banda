/**
 * A web address a machine's Pane hands the device (ADR 0106, law 2). Only
 * http(s) makes one, so what a program on another machine prints never
 * reaches this device's `file:` or `app:`.
 *
 * A public page opens in this device's browser (decision 3). An address of
 * the machine's own, as `localhost:3000` on arc, means this computer here,
 * where nothing of arc's listens, so it is named as that machine's and does
 * not open until port forwarding comes.
 */
export type Link = {
  readonly url: string
  /** The machine whose own address it is, by its name. None for a public
   * page, which is no machine's. */
  readonly of?: string
}

/** The `Link` that `text` is, from machine `of` where that is another
 * machine; none where `text` is no http(s) address. */
export function linkOf(text: string, of?: string): Link | undefined {
  const url = parsed(text)
  if (!url || !/^https?:$/.test(url.protocol)) return undefined
  return { url: text, ...(of !== undefined && own(url) && { of }) }
}

/** Whether `url` names the computer it is opened on. */
function own({ hostname }: URL): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  )
}

function parsed(text: string): URL | undefined {
  try {
    return new URL(text)
  } catch {
    return undefined
  }
}

/** Why `url`, from a Pane of machine `machine`, does not open on this
 * device, in the Person's words: none where it does. */
export function linkRefused(
  url: string,
  machine: string
): { why: string; offer: { about: string; copy: string } } | undefined {
  const link = linkOf(url, machine)
  if (link?.of === undefined) return undefined
  return {
    why: `${new URL(url).host} is ${link.of}'s`,
    offer: { about: "It opens here once port forwarding comes.", copy: url },
  }
}
