import type { Engine, Status } from "@banda/contract"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
import {
  bytesUrl,
  fileMint,
  onRestart,
  relayBytesFrom,
  useFileUrl,
} from "./use-file-url"

/** A session whose engine gives `token` for any path but one that ends in
 * `.secret`, and says each status it is `said` to. */
function session(token = "a5e") {
  const watchers = new Set<(status: Status) => void>()
  let status: Status = { state: "connecting" }
  const call = vi.fn(async (_method: string, params: { path: string }) => {
    if (params.path.endsWith(".secret")) throw new Error("refused")
    return { token, until: 0 }
  })
  const engine = {
    call,
    get status() {
      return status
    },
    watch: (watcher: (status: Status) => void) => {
      watchers.add(watcher)
      watcher(status)
      return () => watchers.delete(watcher)
    },
  } as unknown as Engine
  const said = (now: Status) => {
    status = now
    for (const watcher of watchers) watcher(now)
  }
  return { engine, call, said }
}

/** What a Pane on `engine` gets for `path`, drawn as text. */
function Url({ engine, path }: { engine: Engine; path: string | null }) {
  return <>{String(useFileUrl(engine, "p", path))}</>
}
const urlOf = (engine: Engine, path: string | null) =>
  renderToStaticMarkup(<Url engine={engine} path={path} />)

test("a session the desktop does not relay gets no URL and asks its engine nothing, as with no desktop", () => {
  const { engine, call } = session()
  expect(fileMint(engine, "p")).toBeNull()
  expect(urlOf(engine, "/tmp/shot.png")).toBe("null")
  expect(urlOf(engine, "notes.md")).toBe("null")
  expect(call).not.toHaveBeenCalled()
})

test("the window's own session asks its engine for a token in the Pane's Project, and the URL names it on the host its use is served by", async () => {
  const { engine, call } = session()
  relayBytesFrom(engine)
  const file = fileMint(engine, "p")!
  expect(await file("notes.md")).toBe("app://files/a5e")
  expect(call).toHaveBeenLastCalledWith(
    "bytes.issue",
    { path: "notes.md", use: "file" },
    { project: "p" }
  )
  expect(await fileMint(engine, "q", "page")!("/site/index.html")).toBe(
    "app://preview/a5e"
  )
  expect(call).toHaveBeenLastCalledWith(
    "bytes.issue",
    { path: "/site/index.html", use: "page" },
    { project: "q" }
  )
  expect(await fileMint(engine, "p", "media")!("clip.webm")).toBe(
    "app://files/a5e"
  )
  // A refusal is no URL.
  expect(await file("keys.secret")).toBeNull()
  // Asked for while drawn; nothing for no file.
  expect(urlOf(engine, "/tmp/shot.png")).toBe("undefined")
  expect(urlOf(engine, null)).toBe("null")
})

test("another machine's session asks its own engine, and the URL names that machine for the desktop to relay to (ADR 0106, step 4c)", async () => {
  const { engine, call } = session()
  relayBytesFrom(engine, "arc")
  expect(await fileMint(engine, "p", "media")!("shot.png")).toBe(
    "app://files/arc/a5e"
  )
  expect(call).toHaveBeenLastCalledWith(
    "bytes.issue",
    { path: "shot.png", use: "media" },
    { project: "p" }
  )
  expect(await fileMint(engine, "p", "page")!("index.html")).toBe(
    "app://preview/arc/a5e"
  )
})

test("one function makes the URL: a page's on the sandbox host, the rest on the byte host, another machine's named in it", () => {
  expect(bytesUrl("f00d", "page")).toBe("app://preview/f00d")
  expect(bytesUrl("f00d", "file")).toBe("app://files/f00d")
  expect(bytesUrl("f00d", "media")).toBe("app://files/f00d")
  expect(bytesUrl("f00d", "file", "arc")).toBe("app://files/arc/f00d")
})

test("a restart of the engine is heard once its boot changes, not as it first opens or comes back from a break", () => {
  const { engine, said } = session()
  const heard = vi.fn()
  const stop = onRestart(engine, heard)
  const open = (boot: string): Status => ({
    state: "open",
    engine: "banda",
    modules: [],
    boot,
  })
  said(open("one"))
  said({ state: "lost", retryIn: 100 })
  said(open("one"))
  expect(heard).not.toHaveBeenCalled()
  said({ state: "lost", retryIn: 100 })
  said(open("two"))
  expect(heard).toHaveBeenCalledTimes(1)
  stop()
  said(open("three"))
  expect(heard).toHaveBeenCalledTimes(1)
})
