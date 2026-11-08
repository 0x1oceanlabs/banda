/**
 * Another machine's Threads in the sidebar (ADR 0081, decision 4): the
 * window reaches a second engine, "arc", over ssh. Here ssh is a fake
 * first on the window's PATH: it runs arc's `banda start --with-parent`
 * on this machine, on arc's own folders, and forwards the port itself, as
 * ssh does, so main's check that ssh holds the port holds. arc's label
 * shows below this machine's Projects, with its Projects and Threads;
 * stopped there, it says so, and Start brings it back. With
 * BANDA_E2E_SHOTS set to a folder, it leaves pictures of each state there
 * for the Person to see.
 */
import { execFileSync, spawn } from "node:child_process"
import { once } from "node:events"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { setInFront, startWindow, type Window } from "./window"

const repository = resolve(import.meta.dirname, "../../..")
const program = join(repository, "target/debug/banda")
const agent = join(repository, "target/debug/banda-fake-agent")
const shots = process.env.BANDA_E2E_SHOTS

let window: Window | undefined
let arc: Arc | undefined

test.afterEach(async () => {
  await window?.close()
  arc?.close()
  window = arc = undefined
})

/** A word as sh takes it, whatever it holds. */
const quoted = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`

/**
 * ssh as main runs it, for the host "arc" on this machine: `-G` says a
 * config with no forwards; the forward (`-N`) listens on the port `-L`
 * names, as itself, and carries each connection to arc's engine; the
 * follower runs what main asks there, on arc's folders, unless `down`
 * is there, when it cannot reach arc.
 */
const fakeSsh = (folders: Record<string, string>) => `#!/bin/sh
here=$(dirname "$0")
case "$1" in -G) printf 'hostname arc\\nport 22\\n'; exit 0 ;; esac
for arg; do last=$arg; done
for arg; do
  if [ "$arg" = -N ]; then
    echo $$ > "$here/forward.pid"
    exec ${quoted(process.execPath)} "$here/forward.cjs" "$@"
  fi
done
if [ -e "$here/down" ]; then
  echo "ssh: connect to host arc port 22: Connection refused" >&2
  exit 255
fi
unset BANDA_TOKEN BANDA_ENGINE
${Object.entries(folders)
  .map(([name, path]) => `export ${name}=${quoted(path)}`)
  .join("\n")}
exec sh -c "$last"
`

/** The fake forward: 127.0.0.1:FROM to 127.0.0.1:TO, as `-L` names them. */
const FORWARD = `
const net = require("node:net")
const args = process.argv.slice(2)
const [, from, , to] = args[args.indexOf("-L") + 1].split(":")
net
  .createServer((socket) => {
    const there = net.connect(Number(to), "127.0.0.1")
    const end = () => (socket.destroy(), there.destroy())
    socket.pipe(there).pipe(socket)
    for (const side of [socket, there]) side.on("error", end).on("close", end)
  })
  .listen(Number(from), "127.0.0.1")
`

type Arc = {
  dir: string
  /** The environment of a program on arc. */
  env: NodeJS.ProcessEnv
  /** Where the fake ssh is, for the window's PATH. */
  bin: string
  /** Runs `banda` on arc's folders; what it printed. */
  banda: (...args: string[]) => string
  /** arc cannot be reached while `on`. */
  down: (on: boolean) => void
  /** Ends the forward, as a link that drops does. */
  cut: () => void
  close: () => void
}

/** The machine "arc": its own folders, the fake agent its Harness. */
function newArc(): Arc {
  const dir = mkdtempSync(join(tmpdir(), "banda-arc-"))
  const at = (path: string) => join(dir, path)
  mkdirSync(at("config"), { recursive: true })
  mkdirSync(at("bin"))
  writeFileSync(
    at("config/harnesses.toml"),
    `[[harness]]\nid = "fake"\nname = "Fake AI"\ncommand = ${JSON.stringify(agent)}\n`
  )
  writeFileSync(at("config/sharing.toml"), "problems = false\n")
  const folders = {
    BANDA_ROOT: at("root"),
    BANDA_DATA: at("data"),
    BANDA_STATE: at("state"),
    BANDA_CONFIG: at("config"),
    BANDA_CACHE: at("cache"),
  }
  writeFileSync(at("bin/ssh"), fakeSsh(folders), { mode: 0o755 })
  writeFileSync(at("bin/forward.cjs"), FORWARD)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...folders,
    BANDA_LOG: "warn",
    BANDA_FENCE: "off",
  }
  delete env.BANDA_TOKEN
  delete env.BANDA_ENGINE
  return {
    dir,
    env,
    bin: at("bin"),
    banda: (...args) => execFileSync(program, args, { env, encoding: "utf8" }),
    down: (on) =>
      on ? writeFileSync(at("bin/down"), "") : unlinkSync(at("bin/down")),
    cut: () =>
      process.kill(Number(readFileSync(at("bin/forward.pid"), "utf8"))),
    close: () => {
      try {
        execFileSync(program, ["stop", "--force"], { env, stdio: "ignore" })
      } catch {
        // It stopped already.
      }
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** arc's Project "banda", with a Thread done, made on its engine while no
 * window reaches it; its id. */
async function seed(arc: Arc): Promise<string> {
  const engine = spawn(program, ["start", "--with-parent"], {
    env: arc.env,
    stdio: ["pipe", "pipe", "inherit"],
  })
  await once(engine.stdout, "data")
  const folder = join(arc.dir, "work/banda")
  mkdirSync(folder, { recursive: true })
  const project = JSON.parse(arc.banda("project", "add", folder)).ok.id
  send(arc, project, "Bench window tests")
  await expect
    .poll(() => states(arc, project))
    .toEqual([["Bench window tests", "done"]])
  // The window going ends its engine, as it is the window's child here.
  engine.stdin.end()
  await once(engine, "close")
  return project
}

/** Starts a Thread on arc's engine, in `project`, with `text`. */
function send(arc: Arc, project: string, text: string) {
  arc.banda(
    "call",
    "agents.send",
    "--project",
    project,
    "--params",
    JSON.stringify({ harness: "fake", text, settings: null })
  )
}

/** arc's Threads in `project`, each its title and how its turn stands. */
function states(arc: Arc, project: string) {
  const { ok } = JSON.parse(
    arc.banda("call", "agents.threads", "--project", project)
  ) as { ok: { threads: { title: string; latest?: { state: string } }[] } }
  return ok.threads.map((thread) => [thread.title, thread.latest?.state])
}

const sidebarOf = (page: Page) =>
  page.getByRole("complementary", { name: "Sidebar" })

/** arc's part of the sidebar: its label and what it holds. */
const arcOf = (page: Page) =>
  sidebarOf(page).getByRole("group", { name: "arc", exact: true })

/** This machine's Project "Work", with a Thread done. */
async function work(window: Window) {
  const folder = join(window.dir, "work/Work")
  mkdirSync(folder, { recursive: true })
  const project = JSON.parse(window.banda("project", "add", folder)).ok.id
  window.banda(
    "call",
    "agents.send",
    "--project",
    project,
    "--params",
    JSON.stringify({ harness: "fake", text: "Sidebar for arc", settings: null })
  )
  // A Project added from outside shows as the window comes to the front.
  await setInFront(window.page, false)
  await setInFront(window.page, true)
}

/** A picture of the window for the Person, when they asked for them,
 * once the toasts have gone and the logo has done its move. */
async function shot(page: Page, name: string) {
  if (!shots) return
  await page.mouse.move(900, 700)
  await expect(
    page.getByRole("region", { name: "Notifications" }).getByRole("listitem")
  ).toHaveCount(0, { timeout: 30_000 })
  await page.waitForTimeout(3_000)
  await page.screenshot({ path: join(shots, `pr2-${name}.png`) })
}

test("another machine's Threads show under its name, below this one's; stopped there, Start brings it back", async () => {
  test.setTimeout(shots ? 300_000 : 120_000)
  arc = newArc()
  const banda = await seed(arc)
  window = await startWindow({
    look: 'mode = "dark"\n',
    sidebar: 'preset = "projects"\n',
    files: {
      "config/hosts.toml": `[[hosts]]\nname = "arc"\nssh = "arc"\nbanda = ${JSON.stringify(program)}\n`,
    },
    env: { PATH: `${arc.bin}:${process.env.PATH}` },
  })
  const { page } = window
  await work(window)
  const sidebar = sidebarOf(page)
  await expect(sidebar.getByText("Sidebar for arc")).toBeVisible()

  // Live: arc's label, nothing beside it, and its Project and Threads
  // under it.
  const there = arcOf(page)
  await expect(there.getByRole("heading", { name: "arc" })).toBeVisible()
  await expect(
    there.getByRole("group", { name: "banda", exact: true })
  ).toBeVisible()
  await expect(there.getByText("Bench window tests")).toBeVisible()
  await expect(there.getByRole("status", { name: "Connecting" })).toHaveCount(0)
  // A Thread started there shows as it starts, its timer running.
  send(arc, banda, "Hosts over ssh, wait")
  await expect(
    there.getByRole("button").filter({ hasText: "Hosts over ssh, wait" })
  ).toContainText(/\d:\d\d/)
  await shot(page, "1-projects-live")
  // Its rows open nothing yet, and have no menu.
  const tiles = await page.locator("section[data-tile]").count()
  await there.getByText("Bench window tests").click()
  await there.getByText("Bench window tests").click({ button: "right" })
  await expect(page.getByRole("menu", { name: "Thread menu" })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(
    page.getByRole("region", { name: "Bench window tests", exact: true })
  ).toHaveCount(0)
  await expect(page.locator("section[data-tile]")).toHaveCount(tiles)

  // The Inbox: no label for a live host, and its rows among this
  // machine's, each with its host's name.
  writeFileSync(join(window.dir, "config/sidebar.toml"), 'preset = "inbox"\n')
  await expect(arcOf(page)).toHaveCount(0)
  const tags = sidebar.getByTitle("Its Agent works on arc")
  await expect(tags).toHaveCount(2)
  await expect(
    sidebar
      .getByRole("button")
      .filter({ hasText: "Bench window tests" })
      .getByTitle("Its Agent works on arc")
  ).toHaveText("arc")
  await expect(
    sidebar
      .getByRole("button")
      .filter({ hasText: "Sidebar for arc" })
      .getByTitle("Its Agent works on arc")
  ).toHaveCount(0)
  await shot(page, "2-inbox-live")

  // The link drops and arc cannot be reached: away, its rows still there.
  writeFileSync(
    join(window.dir, "config/sidebar.toml"),
    'preset = "projects"\n'
  )
  await expect(there.getByText("Bench window tests")).toBeVisible()
  arc.down(true)
  arc.cut()
  await expect(there.getByText(/^away/)).toBeVisible()
  await expect(there.getByText("Bench window tests")).toBeVisible()
  if (shots) {
    // As the Person would see it a minute on.
    await expect(there.getByText("away · 1 min")).toBeVisible({
      timeout: 90_000,
    })
    await shot(page, "3-away")
  }
  arc.down(false)
  await expect(there.getByText(/^away/)).toHaveCount(0, { timeout: 60_000 })
  await expect(there.getByText("Bench window tests")).toBeVisible()

  // Stopped there as asked: it says so, its rows go, and Start brings it
  // back.
  arc.banda("stop", "--force")
  await expect(there.getByText("stopped", { exact: true })).toBeVisible()
  await expect(there.getByText("Bench window tests")).toHaveCount(0)
  await shot(page, "4-stopped")
  await there.getByRole("button", { name: "Start" }).click()
  await expect(there.getByText("Bench window tests")).toBeVisible()
  await expect(there.getByText("stopped", { exact: true })).toHaveCount(0)
})
