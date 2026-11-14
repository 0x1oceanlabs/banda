/**
 * A web address a machine's Pane hands the device (ADR 0106, law 2). Only
 * http(s) makes one, so what a program on another machine prints never
 * reaches this device's `file:` or `app:`.
 *
 * A public page opens in this device's browser (decision 3). An address of
 * the machine's own, as `localhost:3000` on arc, means this computer here,
 * where nothing of arc's listens, so it is named as that machine's. A
 * device that can open that machine's port here opens it through a forward
 * (`forward_port`, ADR 0120, decision 2); another says whose it is.
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
  // The whole `//`, as `http:8080` parses too, as an address of no one's.
  const url = /^https?:\/\//i.test(text) ? parsed(text) : undefined
  if (!url) return undefined
  return { url: text, ...(of !== undefined && own(url) && { of }) }
}

/** A host's name with no last dot, which names the same place; `URL`
 * keeps it. */
const plain = (hostname: string) => hostname.replace(/\.$/, "")

/** Whether `name` is `localhost` or a name under it, which a page may
 * read. */
const local = (name: string) =>
  name === "localhost" || name.endsWith(".localhost")

/** Whether `url` names the computer it is opened on. */
function own({ hostname }: URL): boolean {
  const name = plain(hostname)
  return (
    local(name) ||
    name === "0.0.0.0" ||
    name === "[::]" ||
    name === "[::1]" ||
    /^\[::ffff:7f[0-9a-f]{2}:/.test(name) ||
    /^127(\.\d{1,3}){3}$/.test(name)
  )
}

function parsed(text: string): URL | undefined {
  try {
    return new URL(text)
  } catch {
    return undefined
  }
}

/** The port `url` names on its computer: its own, or its scheme's. */
const portOf = (url: URL): number =>
  url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80

/**
 * How a `Link` of a machine's own opens here through a forward (ADR 0120,
 * decision 2): the machine, the `port` to ask of it, the address as the
 * Person reads it, and `at`, the address to open once that port listens on
 * this device as `here`: `localhost`, where the forward listens, the rest
 * as it was. None for a public page.
 */
export function linkForward(link: Link):
  | {
      of: string
      port: number
      named: string
      at: (here: number) => URL
    }
  | undefined {
  if (link.of === undefined) return undefined
  const url = new URL(link.url)
  return {
    of: link.of,
    port: portOf(url),
    named: url.host,
    at: (here) => {
      const at = new URL(url)
      // `app.localhost` names this computer too, and a page may read it.
      if (!local(plain(at.hostname))) at.hostname = "localhost"
      at.port = String(here)
      return at
    },
  }
}

/**
 * The words for a forward asked for `machine`'s `named` address (ADR 0120,
 * decision 2): it opened at the same port; at another, `as` that address,
 * since `port` was taken on `device`; or did not as that machine is away.
 */
export function forwardWords(named: string, machine: string) {
  return {
    opens: `${named} opens from ${machine}`,
    moved: (port: number, as: string, device: string) =>
      `${port} is taken on ${device}: opens as ${as}`,
    away: `${machine} is away: ${named} did not open.`,
  }
}

/** Why `url`, from a Pane of machine `machine`, does not open on a device
 * that opens no port of another machine, in the Person's words: none
 * where it does. */
export function linkRefused(
  url: string,
  machine: string
): { why: string; offer: { about: string; copy: string } } | undefined {
  const link = linkOf(url, machine)
  if (link?.of === undefined) return undefined
  return {
    why: `${new URL(url).host} is ${link.of}'s`,
    offer: {
      about: "This device opens no port of another machine.",
      copy: url,
    },
  }
}
