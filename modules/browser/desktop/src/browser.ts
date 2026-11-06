/**
 * The browser's desktop part (ADR 0013). The page shows browser pages in
 * `<webview>`s; here they are kept apart from Banda (decision 8), each in
 * one of the browser's profiles (profile.ts): the Person's, or the
 * profile of a Project's Agents when they opened its tab, apart from the
 * Person's (ADR 0083, decision 4). Banda's keys, held with the mod, and
 * the browser's own go to the window instead of the page (decision 5).
 * The Pane hears of new tabs, icons and downloads as `BrowserNews`, and
 * the switch writes `browser.toml`. The blocker follows the look's
 * `blocker` (blocker.ts). All of it is the `Browser` service (ADR 0020).
 */
import type { ProjectId } from "@banda/contract"
import {
  agentsPartition,
  BROWSER_BRIDGE,
  type BrowserNews,
  opens,
  PARTITION,
} from "@banda/browser-pane/desktop"
import { BROWSER_FILE } from "@banda/contract/browser"
import { fileOf } from "@banda/contract/look"
import { Context, Effect, FiberSet, Layer, Schema, Stream } from "effect"
import {
  clipboard,
  Menu,
  type MenuItem,
  type Session,
  session,
  shell,
  type WebContents,
} from "electron"
import { Blocker } from "./blocker"
import {
  type Answers,
  type Broke,
  confirm,
  Look,
  type Refused,
  Settings,
  tellPage,
  text,
  Window,
} from "@banda/desktop-kit"
import { Cdp } from "./cdp"
import { Dialogs } from "./dialogs"
import { Drive } from "./drive"
import { BoxArg, Extensions } from "./extensions"
import { keepInForce, keys } from "./keys"
import { attaching, downloaded, keepCertificates, keepProfile } from "./profile"
import { Tabs } from "./tabs"

/** Changes `browser.toml`; refused when the value is not one it takes. */
type Changes = Effect.Effect<void, Refused | Broke>

export class Browser extends Context.Service<
  Browser,
  {
    /** Lets `contents`, Banda's page, show browser pages and nothing
     * else; the extensions hear of each page as a tab. */
    host(contents: WebContents): Effect.Effect<void>
    /** Shows the tabs on top of the pages or left of them. */
    tabs(where: "top" | "left"): Changes
    /** Pins the extension `id` to the browser's row, or takes it off. */
    pin(id: string, pinned: boolean): Changes
    /** Removes the extension `id`, once the Person says so, and its
     * button from the row. */
    remove(id: string): Changes
    /** Shows a file Banda downloaded in its folder; nothing for any
     * other. */
    reveal(path: string): Effect.Effect<void>
  }
>()("banda/Browser") {
  static readonly layer = Layer.effect(Browser)(
    Effect.gen(function* () {
      const extensions = yield* Extensions
      const tabs = yield* Tabs
      const dialogs = yield* Dialogs
      const window = yield* Window
      const settings = yield* Settings
      const look = yield* Look
      const blocker = new Blocker()
      // What a site's question runs stops with the layer.
      const run = yield* FiberSet.makeRuntimePromise()
      /** The profile of the Agents of `agents`, or the Person's when
       * `null`, kept as every profile of the browser is: the first time,
       * it is set up, and its pages are known as theirs. */
      const profile = (agents: ProjectId | null) => {
        const made = session.fromPartition(
          agents === null ? PARTITION : agentsPartition(agents)
        )
        if (tabs.whose({ session: made }) !== undefined) return made
        keepProfile(made, agents, window.now, (asked) =>
          run(confirm(window.now(), asked))
        )
        tabs.profiled(made, agents)
        if (agents !== null) void blocker.add(made)
        return made
      }
      profile(null)
      // An Agents' page shows a site none of the Person's certificates.
      yield* Effect.acquireRelease(
        Effect.sync(() => keepCertificates(tabs.whose)),
        (stop) => Effect.sync(stop)
      )
      // The blocker follows browser.toml, a change at a time, in order.
      yield* Effect.forkScoped(
        look.changes.pipe(
          Stream.map((now) => fileOf(now.files, BROWSER_FILE).blocker),
          Stream.changes,
          Stream.runForEach((on) => Effect.promise(() => blocker.set(on)))
        )
      )
      const write = (key: string, value: unknown) =>
        settings.write("browser.toml", key, value)
      const pin = (id: string, pinned: boolean) =>
        Effect.gen(function* () {
          const files = yield* Look.part("files", "The browser's file")
          const browser = fileOf(files, BROWSER_FILE)
          const others = browser.pinned.filter((each) => each !== id)
          yield* write("pinned", pinned ? [...others, id] : others)
        }).pipe(Effect.provideService(Look, look))
      return {
        host: (contents) =>
          Effect.sync(() => host(contents, profile, tabs, extensions, dialogs)),
        tabs: (where) => write("tabs", where),
        pin: (id, pinned) =>
          Effect.andThen(extensions.named(id), pin(id, pinned)),
        remove: (id) =>
          Effect.flatMap(extensions.remove(id), (removed) =>
            removed ? pin(id, false) : Effect.void
          ),
        reveal: (path) =>
          Effect.sync(() => {
            if (downloaded(path)) shell.showItemInFolder(path)
          }),
      }
    })
  )
}

function host(
  contents: WebContents,
  profile: (agents: ProjectId | null) => Session,
  tabs: Tabs["Service"],
  extensions: Extensions["Service"],
  dialogs: Dialogs["Service"]
): void {
  contents.on("will-attach-webview", (event, prefs, params) => {
    // Only in the browser's profiles, at what a page of each may open.
    const agents = attaching(prefs, params)
    if (agents === undefined) event.preventDefault()
    else profile(agents)
  })
  contents.on("did-attach-webview", (_event, page) => {
    const agents = tabs.whose(page)
    if (agents === undefined) return
    const tell = (news: BrowserNews) =>
      tellPage(contents, BROWSER_BRIDGE.listen, news)
    dialogs.attached(page)
    tabs.attached(page)
    keys(page, contents)
    keep(page, agents, tell, extensions)
  })
}

/** The user agent the browser's pages send: Chrome's (`keepProfile`). */
export function userAgent(): string {
  return session.fromPartition(PARTITION).getUserAgent()
}

/** Keeps a tab's `page`, whose profile is `agents`': what it opens opens
 * in that profile too. */
function keep(
  page: WebContents,
  agents: ProjectId | null,
  tell: (news: BrowserNews) => void,
  extensions: Extensions["Service"]
): void {
  extensions.attached(page)
  const open = (url: string, background: boolean) =>
    tell({
      kind: "open",
      from: page.id,
      url,
      background,
      ...(agents === null ? {} : { agents }),
    })
  page.on("context-menu", (_event, params) =>
    menuOf(page, params, agents, open, extensions).popup()
  )
  page.setWindowOpenHandler(({ url, disposition }) => {
    if (!opens(url, agents)) return { action: "deny" }
    // A popup that needs its opener, as a sign-in, opens as a window of
    // its own; one of those opens nothing more.
    if (disposition === "new-window") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: { autoHideMenuBar: true },
      }
    }
    // The rest is a tab, which the Pane opens beside the page's.
    open(url, disposition === "background-tab")
    return { action: "deny" }
  })
  // A page names its icon again on each load: it is sent once.
  let named = ""
  page.on("page-favicon-updated", (_event, icons) => {
    const first = icons[0]
    if (!first || first === named) return
    named = first
    void iconOf(page, first).then((icon) => {
      if (icon && !page.isDestroyed())
        tell({ kind: "icon", from: page.id, icon })
    })
  })
  page.on("did-create-window", (popup) =>
    popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  )
}

/**
 * A page's menu, as Chrome's in short: the link, the picture, the words or
 * the field under the pointer, the way back and forward, the extensions'
 * own items, and Inspect.
 */
function menuOf(
  page: WebContents,
  params: Electron.ContextMenuParams,
  agents: ProjectId | null,
  open: (url: string, background: boolean) => void,
  extensions: Extensions["Service"]
): Menu {
  const items: Electron.MenuItemConstructorOptions[][] = []
  const tab = (url: string) => open(url, true)
  if (params.linkURL && opens(params.linkURL, agents)) {
    items.push([
      { label: "Open Link in New Tab", click: () => tab(params.linkURL) },
      {
        label: "Copy Link Address",
        click: () => clipboard.writeText(params.linkURL),
      },
    ])
  }
  if (params.mediaType === "image" && opens(params.srcURL, agents)) {
    items.push([
      { label: "Open Image in New Tab", click: () => tab(params.srcURL) },
      {
        label: "Copy Image",
        click: () => page.copyImageAt(params.x, params.y),
      },
    ])
  }
  const edit = params.editFlags
  if (params.isEditable) {
    items.push([
      { role: "undo", enabled: edit.canUndo },
      { role: "redo", enabled: edit.canRedo },
      { role: "cut", enabled: edit.canCut },
      { role: "copy", enabled: edit.canCopy },
      { role: "paste", enabled: edit.canPaste },
      { role: "selectAll", enabled: edit.canSelectAll },
    ])
  } else if (params.selectionText.trim()) {
    items.push([{ role: "copy" }])
  }
  const history = page.navigationHistory
  items.push([
    {
      label: "Back",
      enabled: history.canGoBack(),
      click: () => history.goBack(),
    },
    {
      label: "Forward",
      enabled: history.canGoForward(),
      click: () => history.goForward(),
    },
    { label: "Reload", click: () => page.reload() },
  ])
  const groups: (Electron.MenuItemConstructorOptions | MenuItem)[][] = [
    ...items,
    extensions.menuItems(page, params),
    [
      {
        label: "Inspect",
        click: () => page.inspectElement(params.x, params.y),
      },
    ],
  ]
  return Menu.buildFromTemplate(
    groups
      .filter((group) => group.length)
      .flatMap((group, i) => (i ? [{ type: "separator" }, ...group] : group))
  )
}

/** The largest icon Banda takes from a site. */
const ICON_BYTES = 64 * 1024

/** The icon at `url`, fetched in the page's profile, as a data URL. */
async function iconOf(page: WebContents, url: string): Promise<string | null> {
  try {
    if (url.startsWith("data:image/"))
      return url.length < ICON_BYTES ? url : null
    if (!/^https?:/i.test(url)) return null
    const answer = await page.session.fetch(url)
    const type = answer.headers.get("content-type") ?? ""
    if (!answer.ok || !type.startsWith("image/")) return null
    const bytes = Buffer.from(await answer.arrayBuffer())
    if (bytes.length > ICON_BYTES) return null
    return `data:${type};base64,${bytes.toString("base64")}`
  } catch {
    return null
  }
}

const page = Schema.Tuple([Schema.Number])

/** How main answers the browser's channels (ADR 0028), which main takes
 * in through its `modules.ts` without naming them. */
export const browserAnswers: Answers<
  typeof BROWSER_BRIDGE,
  Browser | Extensions | Tabs | Cdp | Drive | Dialogs
> = {
  tabs: [
    Schema.Tuple([Schema.Literals(["top", "left"])]),
    ([where]) => Browser.use((browser) => browser.tabs(where)),
  ],
  reveal: [text, ([path]) => Browser.use((browser) => browser.reveal(path))],
  keys: [
    Schema.Tuple([
      Schema.Struct({
        mod: Schema.Struct({
          alt: Schema.Boolean,
          ctrl: Schema.Boolean,
          super: Schema.Boolean,
        }),
        keys: Schema.Array(
          Schema.Struct({
            code: Schema.String,
            alt: Schema.optional(Schema.Boolean),
            shift: Schema.optional(Schema.Boolean),
            ctrl: Schema.optional(Schema.Boolean),
            super: Schema.optional(Schema.Boolean),
            primary: Schema.optional(Schema.Boolean),
          })
        ),
      }),
    ]),
    ([keys]) => Effect.sync(() => keepInForce(keys)),
  ],
  shown: [
    page,
    ([page]) =>
      Effect.andThen(
        Extensions.use((extensions) => extensions.shown(page)),
        Dialogs.use((dialogs) => Effect.sync(() => dialogs.replay(page)))
      ),
  ],
  created: [
    Schema.Tuple([Schema.String, Schema.NullOr(Schema.Number)]),
    ([request, page]) => Tabs.use((tabs) => tabs.created(request, page)),
  ],
  dialog: [
    Schema.Tuple([
      Schema.Number,
      Schema.String,
      Schema.Boolean,
      Schema.optional(Schema.String),
    ]),
    ([tab, id, accept, text]) =>
      Dialogs.use((dialogs) => dialogs.answer(tab, id, accept, text)),
  ],
  stop: [page, ([page]) => Cdp.use((cdp) => cdp.stop(page))],
  release: [page, ([page]) => Drive.use((drive) => drive.release(page))],
  answered: [
    Schema.Tuple([Schema.Number, Schema.String]),
    ([page, agent]) => Drive.use((drive) => drive.answered(page, agent)),
  ],
  allowed: [
    Schema.Tuple([
      Schema.Number,
      Schema.String,
      Schema.Literals(["once", "always", "deny"]),
    ]),
    ([page, agent, answer]) =>
      Drive.use((drive) => drive.allowed(page, agent, answer)),
  ],
  settled: [text, ([agent]) => Drive.use((drive) => drive.settled(agent))],
  pin: [
    Schema.Tuple([Schema.String, Schema.Boolean]),
    ([id, pinned]) => Browser.use((browser) => browser.pin(id, pinned)),
  ],
  remove: [text, ([id]) => Browser.use((browser) => browser.remove(id))],
  // What an extension's button sends.
  actions: {
    popup: [
      Schema.Tuple([Schema.String, Schema.String, BoxArg]),
      ([extension, url, under]) =>
        Extensions.use((extensions) => extensions.popup(extension, url, under)),
    ],
  },
}
