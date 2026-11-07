/**
 * The window's door for the `banda` CLI: a Unix socket where `banda menu
 * [route]` asks the window to open the Banda menu (ADR 0017), and on
 * Windows a named pipe, `\\.\pipe\…` (ADR 0090, decision 5). The engine
 * names its path, so the CLI and the window find it the same way. One
 * JSON line comes in, an object of one command and its value, and one
 * line goes back: `ok`, or what went wrong.
 *
 * It carries no owner's access: it only opens the menu. Node makes the
 * pipe with Windows' default access list, which lets no other account
 * write to it; a test on Windows holds to that (engine/tests/windows.rs).
 */
import { mkdirSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { dirname } from "node:path"
import { createInterface } from "node:readline"

/** What the window does for each command: `ok`, or what went wrong. */
export type Commands = Record<string, (value: unknown) => string>

/** Whether `path` names a named pipe of Windows, which has no folder to
 * make and no file to remove: it goes with the window. */
export const isPipe = (path: string) => /^\\\\[.?]\\pipe\\/i.test(path)

/**
 * Listens at `path` and answers each line by `commands`; returns how to
 * shut it. The single-instance lock makes this window the only one, so a
 * socket left from before is taken over.
 */
export function openDoor(path: string, commands: Commands): () => void {
  const pipe = isPipe(path)
  if (!pipe) {
    mkdirSync(dirname(path), { recursive: true })
    rmSync(path, { force: true })
  }
  const server = createServer((socket) => {
    socket.on("error", () => socket.destroy())
    createInterface({ input: socket }).once("line", (line) =>
      socket.end(`${answer(line, commands)}\n`)
    )
  })
  server.on("error", (error: NodeJS.ErrnoException) =>
    // On Windows another program made a pipe of this name first: no
    // `banda menu` reaches this window.
    pipe && error.code === "EADDRINUSE"
      ? console.error(`door: another program holds ${path}`)
      : console.error("door:", error)
  )
  server.listen(path)
  return () => {
    server.close()
    if (!pipe) rmSync(path, { force: true })
  }
}

function answer(line: string, commands: Commands): string {
  let asked: unknown
  try {
    asked = JSON.parse(line)
  } catch {
    return "not JSON"
  }
  const pairs =
    typeof asked === "object" && asked !== null ? Object.entries(asked) : []
  if (pairs.length !== 1) return "not one command"
  const [[name, value]] = pairs
  const command = Object.hasOwn(commands, name) ? commands[name] : undefined
  return command ? command(value) : `no command ${name}`
}
