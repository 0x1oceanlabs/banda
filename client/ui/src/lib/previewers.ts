/**
 * Which previewer draws a file (ADR 0073, decision 6): the one the Person
 * picked for its extension, if it matches; else the one that matches it
 * best, by its extension, then its MIME type, then a family of MIME types,
 * then the bytes it starts with, then one that draws any file; among
 * equals, the higher priority. Pure,
 * so plain tests cover it. The window gives every module's previewers to
 * what it draws (`Previewers`).
 */
import {
  type ComponentType,
  createContext,
  createElement,
  type LazyExoticComponent,
  lazy,
  type ReactElement,
  useContext,
} from "react"
import type { Bytes, Magic, Previewer, PreviewProps } from "../previewer"

/** What is known of a file: its path, its MIME type, and maybe the bytes
 * it starts with. */
export type Known = {
  path: string
  mime?: string | null
  head?: Uint8Array
}

/** A file's extension, lower case; none for a name with none. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

/** Whether `head` holds `magic`. */
function holds(head: Uint8Array, { at = 0, bytes }: Magic): boolean {
  if (head.length < at + bytes.length) return false
  for (let n = 0; n < bytes.length; n++)
    if (head[at + n] !== bytes.charCodeAt(n)) return false
  return true
}

/** How a previewer that draws any file matches one: after its bytes. */
const ANY = 4

/** How `previewer` matches `file`, the closer the lower: by its extension
 * 0, its MIME type 1, its MIME's family 2, its bytes 3, as one that draws
 * any file 4; none when it does not. */
export function matchOf(previewer: Previewer, file: Known): number | null {
  const { extensions = [], mimes = [], magic = [], any } = previewer.match
  const extension = extensionOf(file.path)
  if (extension && extensions.includes(extension)) return 0
  const mime = file.mime ?? ""
  if (mime && mimes.includes(mime)) return 1
  if (mime && mimes.includes(`${mime.split("/")[0]}/*`)) return 2
  const { head } = file
  if (head && magic.some((one) => holds(head, one))) return 3
  return any ? ANY : null
}

/** The previewers that draw `file`, the best first: what "Open with…"
 * offers. */
export function previewersFor(
  all: readonly Previewer[],
  file: Known
): Previewer[] {
  return all
    .flatMap((previewer) => {
      const match = matchOf(previewer, file)
      return match === null ? [] : [{ previewer, match }]
    })
    .sort(
      (a, b) => a.match - b.match || b.previewer.priority - a.previewer.priority
    )
    .map(({ previewer }) => previewer)
}

/** The previewer that draws `file`: the one `picks` names for its
 * extension (`files.toml`'s `[previewers]`) when it matches the file,
 * else the best; none when none matches. */
export function pickPreviewer(
  all: readonly Previewer[],
  file: Known,
  picks: Readonly<Record<string, string | undefined>> = {}
): Previewer | null {
  const found = previewersFor(all, file)
  const picked = picks[extensionOf(file.path)]
  return found.find((one) => one.id === picked) ?? found[0] ?? null
}

/** Whether the bytes `file` starts with may pick its previewer: none
 * matches its name or MIME type but one that draws any file, and one
 * looks at bytes. */
export function wantsHead(all: readonly Previewer[], file: Known): boolean {
  const known = { ...file, head: undefined }
  return (
    all.every((one) => (matchOf(one, known) ?? ANY) >= ANY) &&
    all.some((one) => (one.match.magic?.length ?? 0) > 0)
  )
}

/** How many bytes of a file's start the previewers look at. */
export function headLength(all: readonly Previewer[]): number {
  return Math.max(
    0,
    ...all.flatMap((one) =>
      (one.match.magic ?? []).map(({ at = 0, bytes }) => at + bytes.length)
    )
  )
}

/** Those of `all` a Pane of another machine is handed (ADR 0106, decision
 * 2): the ones that say `elsewhere`, as the rest would reach this
 * device's disk for another machine's file. A file none of these draws
 * shows its facts. */
export function elsewherePreviewers(
  all: readonly Previewer[]
): readonly Previewer[] {
  return all.filter((previewer) => previewer.elsewhere)
}

/** Every module's previewers, as the window gives them. */
export const Previewers = createContext<readonly Previewer[]>([])

/** Every module's previewers, in the modules' order. */
export function usePreviewers(): readonly Previewer[] {
  return useContext(Previewers)
}

const views = new WeakMap<
  Previewer,
  LazyExoticComponent<ComponentType<PreviewProps>>
>()

/** `previewer`'s view, loaded once, as it is first drawn. */
function viewOf(previewer: Previewer) {
  let view = views.get(previewer)
  if (!view) views.set(previewer, (view = lazy(previewer.load)))
  return view
}

/**
 * What draws a file with `previewer`, under a `Suspense` while its view
 * loads. It is keyed by the previewer, not the file: the next file of the
 * same kind goes to the same view, which updates, and Quick Look keeps up
 * with the arrows; a file of another kind is drawn anew.
 */
export function previewOf(
  previewer: Previewer,
  props: PreviewProps
): ReactElement {
  return createElement(viewOf(previewer), { key: previewer.id, ...props })
}

/** The bytes at `url`, all or `range` of them, as a file host serves
 * them. */
export async function readBytes(
  url: string | null | undefined,
  range: Bytes | undefined,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (!url) throw new Error("This file has no URL to read it at.")
  const response = await fetch(url, {
    signal,
    ...(range && {
      headers: { Range: `bytes=${range.from}-${range.to ?? ""}` },
    }),
  })
  if (!response.ok) throw new Error(`The file host said ${response.status}.`)
  return new Uint8Array(await response.arrayBuffer())
}
