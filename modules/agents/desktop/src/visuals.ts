/**
 * Where the window serves Visuals (ADR 0037, decision 4):
 * `app://visuals/<space>/<visual>`, an origin apart from Banda's page.
 * Main reads each page from the engine, through its one client (ADR
 * 0029), and serves it dressed (page.ts), sandboxed by its own response,
 * and nothing else there.
 */
import { SANDBOX, VISUALS } from "@banda/agents-pane/visual"
import type { SpaceId } from "@banda/contract"
import type { VisualId } from "@banda/contract/agents"
import { Engine } from "@banda/desktop-kit"
import { Effect } from "effect"
import { dressed } from "./page"

/** An ID as the engine makes them: a UUID. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The Space and the Visual an address names, if it names one. */
export function named(
  address: string
): { space: SpaceId; visual: VisualId } | null {
  const url = URL.parse(address)
  if (!url || url.host !== VISUALS) return null
  const [space, visual, ...more] = url.pathname.split("/").filter(Boolean)
  if (more.length > 0 || !ID.test(space ?? "") || !ID.test(visual ?? ""))
    return null
  return { space: space as SpaceId, visual: visual as VisualId }
}

/** A Visual's page, as the engine keeps it; none for one it has not. */
type Read = (space: SpaceId, visual: VisualId) => Promise<string | null>

/** The response for `address`: the page, or a plain "not found". */
export async function serve(address: string, read: Read): Promise<Response> {
  const asked = named(address)
  const html = asked && (await read(asked.space, asked.visual))
  if (html === null) return new Response("Not found", { status: 404 })
  return new Response(dressed(html), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // An opaque origin, whatever frame loads it.
      "Content-Security-Policy": `sandbox ${SANDBOX}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  })
}

/** Serves a request for a Visual, read through main's engine client. */
export const served = (request: Request) =>
  Effect.gen(function* () {
    const client = yield* Engine.use((engine) => engine.client)
    const read: Read = (space, visual) =>
      client.call("agents.visual", { visual }, { space }).then(
        (page) => page.html,
        () => null
      )
    return yield* Effect.promise(() => serve(request.url, read))
  })
