import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import { filesHost } from "../desktop"
import { useFileUrl } from "./use-file-url"

afterEach(() => {
  vi.unstubAllGlobals()
})

/** What a Pane gets for `path`, drawn as text. */
function Url({ path }: { path: string | null }) {
  return <>{String(useFileUrl("p", path))}</>
}
const urlOf = (path: string | null) => renderToStaticMarkup(<Url path={path} />)

test("with no desktop, as in the browser build and in tests, a file has no URL", () => {
  expect(typeof window).toBe("undefined")
  expect(filesHost()).toBeUndefined()
  expect(urlOf("/tmp/shot.png")).toBe("null")
  expect(urlOf("notes.md")).toBe("null")
})

test("in the desktop window a file's URL is asked for, and nothing is for no file", () => {
  const url = vi.fn(async () => "app://files/a.b")
  vi.stubGlobal("window", { banda: { files: { url } } })
  expect(filesHost()?.url).toBe(url)
  expect(urlOf("/tmp/shot.png")).toBe("undefined")
  expect(urlOf(null)).toBe("null")
})
