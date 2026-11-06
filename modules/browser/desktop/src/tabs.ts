/**
 * The browser's tabs, as main sees them: the pages Banda's page attached
 * (ADR 0013), and whose each is. A tab is the Person's, or a Project's
 * Agents', as the profile it loads in says (ADR 0083, decision 4).
 * Extensions and Banda's tools for Agents read them here, open one
 * through the Pane in front, and close or show one through its Pane.
 */
import { randomUUID } from "node:crypto"
import type { Participant, ProjectId } from "@banda/contract"
import { BROWSER_BRIDGE, type BrowserNews } from "@banda/browser-pane/desktop"
import {
  Context,
  Deferred,
  Effect,
  Layer,
  Option,
  PubSub,
  Stream,
} from "effect"
import { type Session, type WebContents, webContents } from "electron"
import { Refused, tellPage, Window } from "@banda/desktop-kit"

/** How long a Pane has to make a tab it was asked for. */
const CREATING = "10 seconds"

/** A tab's page attached, or went. */
export type Change = { kind: "attached" | "gone"; page: WebContents }

/** The page of a tab, as far as whose it is: its profile's session. */
type Profiled = Pick<WebContents, "session">

/** A tab no call may name: one there is not, or one outside its reach. */
export const noTab = (tab: number) =>
  new Refused({
    code: "not_found",
    message: `There is no tab ${tab}: browser_tabs lists them.`,
  })

export class Tabs extends Context.Service<
  Tabs,
  {
    /** The tabs' pages now, in the order they attached. */
    all(): WebContents[]
    /** Each tab's page that attaches or goes, from when it runs. */
    readonly changes: Stream.Stream<Change>
    /** Banda's page attached `page`: a tab's, until it goes. */
    attached(page: WebContents): void
    /** `profile` is the browser's profile of the Agents of `agents`, or
     * the Person's when `null`: the pages that load in it are theirs. */
    profiled(profile: Session, agents: ProjectId | null): void
    /** Whose `page` is: the Project whose Agents' profile it loads in, or
     * `null` for the Person's; `undefined` for a page of no profile of
     * the browser's. */
    agentsOf(page: Profiled): ProjectId | null | undefined
    /**
     * The tabs a call of `by` in `project` may see and drive: those the
     * Agents of `project` opened, and those the Person lent the Thread of
     * `by` (ADR 0083, decision 4). No other tab is in its reach.
     */
    seen(project: ProjectId, by: Participant): WebContents[]
    /** Asks for a tab at `url`, in the Pane in front, or beside the
     * Thread of `agent`; in the profile of `agents`' Agents, or the
     * Person's. Its page, once made in that profile. */
    create(
      url?: string,
      agent?: string,
      agents?: ProjectId
    ): Effect.Effect<WebContents, Refused>
    /** A Pane made the page, by its ID, for the tab asked for with
     * `request`; or none, when it could not. */
    created(request: string, page: number | null): Effect.Effect<void>
    /** Tells the Panes `news` of their tabs. */
    tell(news: BrowserNews): void
  }
>()("banda/Tabs") {
  static readonly layer = Layer.effect(Tabs)(
    Effect.gen(function* () {
      const window = yield* Window
      const pages = new Set<WebContents>()
      const changed = yield* PubSub.unbounded<Change>()
      /** Whose each of the browser's profiles is. */
      const profiles = new WeakMap<Session, ProjectId | null>()
      /** The tabs the Person lent a Thread, each to its Agent's ID. Only
       * the Person's lend gesture adds one, and it is not built yet: no
       * tab is lent, and a call reaches its Project's Agents' tabs alone
       * (ADR 0083, decision 4). */
      const lent = new WeakMap<WebContents, string>()
      /** Tabs asked for, until a Pane made their pages. */
      const creating = new Map<string, Deferred.Deferred<number | null>>()
      const publish = (change: Change) => PubSub.publishUnsafe(changed, change)
      const tell = (news: BrowserNews) =>
        tellPage(window.now()?.webContents, BROWSER_BRIDGE.listen, news)
      const agentsOf = (page: Profiled) => profiles.get(page.session)

      return {
        all: () => [...pages],
        changes: Stream.fromPubSub(changed),
        attached: (page) => {
          pages.add(page)
          publish({ kind: "attached", page })
          page.once("destroyed", () => {
            pages.delete(page)
            publish({ kind: "gone", page })
          })
        },
        profiled: (profile, agents) => {
          profiles.set(profile, agents)
        },
        agentsOf,
        seen: (project, by) =>
          [...pages].filter(
            (page) =>
              agentsOf(page) === project ||
              (by.kind === "agent" && lent.get(page) === by.id)
          ),
        create: (url = "about:blank", agent, agents) =>
          Effect.gen(function* () {
            const request = randomUUID()
            const made = yield* Deferred.make<number | null>()
            creating.set(request, made)
            tell({
              kind: "create",
              request,
              url,
              ...(agent ? { agent } : {}),
              ...(agents ? { agents } : {}),
            })
            const id = yield* Deferred.await(made).pipe(
              Effect.timeoutOption(CREATING),
              Effect.ensuring(Effect.sync(() => creating.delete(request)))
            )
            const page = pageOf(Option.getOrNull(id))
            // A tab is made in the profile asked for, or it is none.
            if (!page || agentsOf(page) !== (agents ?? null))
              return yield* new Refused({
                message: "No browser in Banda could open the tab.",
              })
            return page
          }),
        created: (request, page) =>
          Effect.suspend(() => {
            const made = creating.get(request)
            return made ? Deferred.succeed(made, page) : Effect.void
          }),
        tell,
      }
    })
  )
}

/** The browser's page of `id`; none for any other web contents. */
export function pageOf(id: number | null): WebContents | undefined {
  const page = id === null ? undefined : webContents.fromId(id)
  return page && !page.isDestroyed() && page.getType() === "webview"
    ? page
    : undefined
}
