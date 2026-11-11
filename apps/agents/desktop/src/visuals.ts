/**
 * Where the window serves Visuals (ADR 0037, decision 4):
 * `app://visuals/<project>/<visual>`, an origin apart from Banda's page.
 * Main reads each page from the engine, through its one client (ADR
 * 0029), and serves it dressed (page.ts), sandboxed by its own response,
 * and nothing else there.
 *
 * A Visual another machine keeps is at `app://visuals/of/<machine>/<token>`
 * (ADR 0106, decision 6): its engine gave the token for the page, and
 * serves it at `/p/<token>`, which main relays as it does the sandbox
 * host's pages. It is dressed and sandboxed here the same.
 */
import { ELSEWHERE, SANDBOX, VISUALS } from "@banda/agents-pane/visual"
import type { ProjectId } from "@banda/contract"
import type { VisualId } from "@banda/contract/agents"
import { Engine, type Relayed } from "@banda/desktop-kit"
import { Effect } from "effect"
import { dressed } from "./page"

/** An ID as the engine makes them: a UUID. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The Project and the Visual an address names, if it names one. */
export function named(
  address: string
): { project: ProjectId; visual: VisualId } | null {
  const url = URL.parse(address)
  if (!url || url.host !== VISUALS) return null
  const [project, visual, ...more] = url.pathname.split("/").filter(Boolean)
  if (more.length > 0 || !ID.test(project ?? "") || !ID.test(visual ?? ""))
    return null
  return { project: project as ProjectId, visual: visual as VisualId }
}

/** A machine in `hosts.toml`, and a token as an engine gives one. */
const MACHINE = /^[a-z0-9-]+$/
const TOKEN = /^[\w-]+$/

/** The sandbox host's URL for the page of the Visual of another machine's
 * that `address` names, which main relays to that machine's engine; none
 * for an address that names no such Visual. */
export function relayedFor(address: string): string | null {
  const url = URL.parse(address)
  if (!url || url.host !== VISUALS) return null
  const [first, machine = "", token = "", ...more] = url.pathname
    .split("/")
    .filter(Boolean)
  if (first !== ELSEWHERE || more.length > 0) return null
  if (!MACHINE.test(machine) || !TOKEN.test(token)) return null
  return `app://preview/${machine}/${token}`
}

/** A Visual's page, as the engine keeps it; none for one it has not. */
type Read = (project: ProjectId, visual: VisualId) => Promise<string | null>

/** The response for `address`: the page, or a plain "not found". */
export async function serve(address: string, read: Read): Promise<Response> {
  const asked = named(address)
  const html = asked && (await read(asked.project, asked.visual))
  if (html === null) return new Response("Not found", { status: 404 })
  return pageResponse(html)
}

/** A Visual's page as a frame or the check loads it. */
export function pageResponse(html: string): Response {
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

/** The page another machine's engine answered with, dressed as this
 * machine's are; a plain "not found" for any other answer, as for a token
 * that ended, and for a link that broke as the page came. */
export async function serveRelayed(answer: Response): Promise<Response> {
  const missing = new Response("Not found", { status: 404 })
  if (!answer.ok) {
    // Unread, its connection would stay open.
    await answer.body?.cancel().catch(() => undefined)
    return missing
  }
  return answer.text().then(pageResponse, () => missing)
}

/** Serves a request for a Visual: this machine's, read through main's
 * engine client, and another machine's, through main's relay. */
export const served = (request: Request, relayed: Relayed) =>
  Effect.gen(function* () {
    const elsewhere = relayedFor(request.url)
    if (elsewhere !== null) {
      const answer = yield* relayed(elsewhere)
      return yield* Effect.promise(() => serveRelayed(answer))
    }
    const client = yield* Engine.use((engine) => engine.client)
    const read: Read = (project, visual) =>
      client.call("agents.visual", { visual }, { project }).then(
        (page) => page.html,
        () => null
      )
    return yield* Effect.promise(() => serve(request.url, read))
  })
