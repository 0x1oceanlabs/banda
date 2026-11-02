/**
 * The browser's tabs, as main sees them: the pages Banda's page attached
 * (ADR 0013). Extensions and the CDP endpoint both read them here, open
 * one through the Pane in front, and close or show one through its Pane.
 */
import { randomUUID } from "node:crypto"
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
import { type WebContents, webContents } from "electron"
import { Refused, tellPage, Window } from "@banda/desktop-kit"

/** How long a Pane has to make a tab it was asked for. */
const CREATING = "10 seconds"

/** A tab's page attached, or went. */
export type Change = { kind: "attached" | "gone"; page: WebContents }

export class Tabs extends Context.Service<
  Tabs,
  {
    /** The tabs' pages now, in the order they attached. */
    all(): WebContents[]
    /** Each tab's page that attaches or goes, from when it runs. */
    readonly changes: Stream.Stream<Change>
    /** Banda's page attached `page`: a tab's, until it goes. */
    attached(page: WebContents): void
    /** Asks the Pane in front for a tab at `url`; its page, once made. */
    create(url?: string): Effect.Effect<WebContents, Refused>
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
      /** Tabs asked for, until a Pane made their pages. */
      const creating = new Map<string, Deferred.Deferred<number | null>>()
      const publish = (change: Change) => PubSub.publishUnsafe(changed, change)
      const tell = (news: BrowserNews) =>
        tellPage(window.now()?.webContents, BROWSER_BRIDGE.listen, news)

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
        create: (url = "about:blank") =>
          Effect.gen(function* () {
            const request = randomUUID()
            const made = yield* Deferred.make<number | null>()
            creating.set(request, made)
            tell({ kind: "create", request, url })
            const id = yield* Deferred.await(made).pipe(
              Effect.timeoutOption(CREATING),
              Effect.ensuring(Effect.sync(() => creating.delete(request)))
            )
            const page = pageOf(Option.getOrNull(id))
            if (!page)
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
