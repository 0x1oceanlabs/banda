import { expect, test } from "vitest"
import { named, serve } from "./visuals"

const SPACE = "0199d1c2-7f3a-7c11-9e2b-1a2b3c4d5e6f"
const VISUAL = "0199d1c2-7f3a-7c11-9e2b-6f5e4d3c2b1a"
const address = `app://visuals/${SPACE}/${VISUAL}`

test("an address names a Space and a Visual by their IDs, or nothing", () => {
  expect(named(address)).toEqual({ space: SPACE, visual: VISUAL })
  expect(named(`${address}#banda-look=x`)).toEqual({
    space: SPACE,
    visual: VISUAL,
  })
  expect(named(`app://banda/${SPACE}/${VISUAL}`)).toBeNull()
  expect(named(`app://visuals/${SPACE}`)).toBeNull()
  expect(named(`app://visuals/${SPACE}/${VISUAL}/more`)).toBeNull()
  expect(named(`app://visuals/${SPACE}/..%2F..%2Fetc`)).toBeNull()
})

test("a Visual is served dressed and sandboxed; any other address is not found", async () => {
  const asked: string[] = []
  const read = async (space: string, visual: string) => {
    asked.push(`${space}/${visual}`)
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

  const other = `app://visuals/${SPACE}/${SPACE}`
  expect((await serve(other, read)).status).toBe(404)
  expect((await serve("app://visuals/nothing", read)).status).toBe(404)
  expect(asked).toEqual([`${SPACE}/${VISUAL}`, `${SPACE}/${SPACE}`])
})
