/**
 * The browser's tabs, as main sees them: the pages Banda's page attached
 * (ADR 0013), whose each is, and which the Person lent a Thread. A tab is
 * the Person's, or a Project's Agents', as the profile it loads in says
 * (ADR 0083, decision 4). Extensions and Banda's tools for Agents read
 * them here, open one through the Pane in front, and close or show one
 * through its Pane.
 */
import { randomUUID } from "node:crypto"
import type { Participant, ProjectId } from "@banda/contract"
import type { Lending } from "@banda/contract/browser"
import {
  BROWSER_BRIDGE,
  type BrowserNews,
  type Lend,
} from "@banda/browser-pane/desktop"
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

/** A tab asked for: at `url`, blank when left out; in the Pane in front,
 * or beside the Thread of the Agent `agent`; in the profile of the Agents
 * of the Project `agents`, or the Person's when left out. */
export type Creating = { url?: string; agent?: string; agents?: ProjectId }

/** A tab's page attached, or went. */
export type Change = { kind: "attached" | "gone"; page: WebContents }

/** A lend that began, or ended and how: of `page`, titled `tab` then. */
export type LendChange = {
  page: WebContents
  lend: Lend
  lending: Lending
  tab: string
}

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
    whose(page: Profiled): ProjectId | null | undefined
    /**
     * The tabs a call of `by` in `project` may see and drive: those the
     * Agents of `project` opened, and those the Person lent the Thread of
     * `by` (ADR 0083, decision 4). No other tab is in its reach.
     */
    seen(project: ProjectId, by: Participant): WebContents[]
    /**
     * Lends `page`, a tab of the Person's, to the Thread `to` names, by
     * the Person's gesture; or takes it back, with none. A tab is lent to
     * one Thread at a time: lent to another, it is first taken back.
     * Refused for any other tab.
     */
    lend(page: WebContents, to: Lend | null): Effect.Effect<void, Refused>
    /** The lend of `page`; none while it is not lent. */
    lentTo(page: WebContents): Lend | undefined
    /** Every Thread's session ended, as the engine they ran in did: each
     * lend ends. */
    ended(): void
    /** Each lend that begins or ends, from when it runs. A lend ends as
     * the Person takes it back, its tab closes, or its Thread's session
     * ends (ADR 0083, decision 4). */
    readonly lends: Stream.Stream<LendChange>
    /** Asks for a tab, as `asked` says. Its page, once made in the
     * profile asked for. */
    create(asked?: Creating): Effect.Effect<WebContents, Refused>
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
      /** The tabs the Person lent a Thread, each with its lend: only
       * their gesture adds one (ADR 0083, decision 4). */
      const lent = new Map<WebContents, Lend>()
      const lending = yield* PubSub.unbounded<LendChange>()
      /** Tabs asked for, until a Pane made their pages. */
      const creating = new Map<string, Deferred.Deferred<number | null>>()
      const publish = (change: Change) => PubSub.publishUnsafe(changed, change)
      const tell = (news: BrowserNews) =>
        tellPage(window.now()?.webContents, BROWSER_BRIDGE.listen, news)
      const whose = (page: Profiled) => profiles.get(page.session)
      /** The lend of `page` ends, `how`, and the Pane hears it unless the
       * page went. */
      const end = (page: WebContents, how: Exclude<Lending, "lent">) => {
        const lend = lent.get(page)
        if (!lend) return
        lent.delete(page)
        const gone = page.isDestroyed()
        if (!gone) tell({ kind: "lent", from: page.id, agent: null })
        const tab = gone ? "" : page.getTitle()
        PubSub.publishUnsafe(lending, { page, lend, lending: how, tab })
      }

      return {
        all: () => [...pages],
        changes: Stream.fromPubSub(changed),
        attached: (page) => {
          pages.add(page)
          publish({ kind: "attached", page })
          page.once("destroyed", () => {
            pages.delete(page)
            end(page, "closed")
            publish({ kind: "gone", page })
          })
        },
        profiled: (profile, agents) => {
          profiles.set(profile, agents)
        },
        whose,
        seen: (project, by) =>
          [...pages].filter((page) => {
            if (whose(page) === project) return true
            const lend = lent.get(page)
            return (
              by.kind === "agent" &&
              lend?.agent === by.id &&
              lend.project === project
            )
          }),
        lend: (page, to) =>
          Effect.suspend(() => {
            if (!pages.has(page) || page.isDestroyed() || whose(page) !== null)
              return Effect.fail(
                new Refused({ message: "Only a tab of yours is lent." })
              )
            const was = lent.get(page)
            if (was?.agent === to?.agent) return Effect.void
            end(page, "back")
            if (!to) return Effect.void
            lent.set(page, to)
            tell({ kind: "lent", from: page.id, agent: to.agent })
            const began: LendChange = {
              page,
              lend: to,
              lending: "lent",
              tab: page.getTitle(),
            }
            PubSub.publishUnsafe(lending, began)
            return Effect.void
          }),
        lentTo: (page) => lent.get(page),
        ended: () => {
          for (const page of [...lent.keys()]) end(page, "session")
        },
        lends: Stream.fromPubSub(lending),
        create: ({ url = "about:blank", agent, agents } = {}) =>
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
            if (!page || whose(page) !== (agents ?? null))
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
