import { expect, test } from "vitest"
import { named, serve } from "./visuals"

const PROJECT = "0199d1c2-7f3a-7c11-9e2b-1a2b3c4d5e6f"
const VISUAL = "0199d1c2-7f3a-7c11-9e2b-6f5e4d3c2b1a"
const address = `app://visuals/${PROJECT}/${VISUAL}`

test("an address names a Project and a Visual by their IDs, or nothing", () => {
  expect(named(address)).toEqual({ project: PROJECT, visual: VISUAL })
  expect(named(`${address}#banda-look=x`)).toEqual({
    project: PROJECT,
    visual: VISUAL,
  })
  expect(named(`app://banda/${PROJECT}/${VISUAL}`)).toBeNull()
  expect(named(`app://visuals/${PROJECT}`)).toBeNull()
  expect(named(`app://visuals/${PROJECT}/${VISUAL}/more`)).toBeNull()
  expect(named(`app://visuals/${PROJECT}/..%2F..%2Fetc`)).toBeNull()
})

test("a Visual is served dressed and sandboxed; any other address is not found", async () => {
  const asked: string[] = []
  const read = async (project: string, visual: string) => {
    asked.push(`${project}/${visual}`)
    return visual === VISUAL ? "<p>Hi</p>" : null
  }
  const shown = await serve(address, read)
  expect(shown.status).toBe(200)
  expect(shown.headers.get("Content-Security-Policy")).toBe(
    "sandbox allow-scripts allow-forms"
  )
  expect(shown.headers.get("Content-Type")).toBe("text/html; charset=utf-8")
  expect(shown.headers.get("X-Content-Type-Options")).toBe("nosniff")
  const html = await shown.text()
  expect(html.startsWith('<meta charset="utf-8">')).toBe(true)
  expect(html.endsWith("<p>Hi</p>")).toBe(true)

  const other = `app://visuals/${PROJECT}/${PROJECT}`
  expect((await serve(other, read)).status).toBe(404)
  expect((await serve("app://visuals/nothing", read)).status).toBe(404)
  expect(asked).toEqual([`${PROJECT}/${VISUAL}`, `${PROJECT}/${PROJECT}`])
})
