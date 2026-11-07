import { mkdtempSync } from "node:fs"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { isPipe, openDoor } from "./door"

/** What the door at `path` answers to `line`. */
const answered = (path: string, line: string) =>
  new Promise<string>((done, fail) => {
    let heard = ""
    const socket = createConnection(path, () => socket.write(`${line}\n`))
    socket.on("data", (data) => {
      heard += data
    })
    socket.on("end", () => done(heard))
    socket.on("error", fail)
  })

/** `answered`, once the door listens: it opens a moment after it is made. */
async function knock(path: string, line: string): Promise<string> {
  for (let tries = 0; ; tries++)
    try {
      return await answered(path, line)
    } catch (error) {
      if (tries === 100) throw error
      await new Promise((done) => setTimeout(done, 10))
    }
}

test("the door answers one line by its commands", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "banda-door-")), "s", "w.sock")
  const shut = openDoor(path, { menu: (route) => `menu ${String(route)}` })
  try {
    expect(await knock(path, '{"menu":"actions"}')).toBe("menu actions\n")
    expect(await knock(path, "menu")).toBe("not JSON\n")
    expect(await knock(path, '{"quit":1}')).toBe("no command quit\n")
    expect(await knock(path, '{"menu":"a","quit":1}')).toBe("not one command\n")
  } finally {
    shut()
  }
})

test("on Windows the engine names a pipe, which has no folder or file", () => {
  expect(isPipe("\\\\.\\pipe\\banda-window-0123456789abcdef")).toBe(true)
  expect(isPipe("\\\\?\\pipe\\banda-window")).toBe(true)
  expect(isPipe("/home/ro/.local/state/banda/window.sock")).toBe(false)
  expect(
    isPipe("C:\\Users\\Ro\\AppData\\Local\\banda\\state\\window.sock")
  ).toBe(false)
})
