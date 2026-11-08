/**
 * Another machine's Threads in the sidebar (ADR 0081, decision 4): the
 * window reaches a second engine, "arc", over ssh. Here ssh is a fake
 * first on the window's PATH: it runs arc's `banda start --with-parent`
 * on this machine, on arc's own folders, and forwards the port itself, as
 * ssh does, so main's check that ssh holds the port holds. arc's label
 * shows below this machine's Projects, with its Projects and Threads;
 * stopped there, it says so, and Start brings it back. Its Thread opens
 * from the sidebar on arc's engine, and waits while arc is away; Alt+U
 * and a toast open one there too, as `pane.pick` keeps its host. As a
 * Mac, its `uname` says Darwin, and the window finds its Banda in its
 * Application Support; its engine is this checkout's still, which serves
 * for the follower, as a Mac's does not (engine/src/control.rs). With
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
import { dirname, join, resolve } from "node:path"
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

/** Where a Mac keeps Banda Local's copy of `banda`, from its home. */
const MAC_COPY = "Library/Application Support/banda-local/engine/0.1.0/banda"

/** The machine "arc": its own folders, the fake agent its Harness. As a
 * `mac`, its `uname` says Darwin, and its Banda is a copy in its home's
 * Application Support that notes each run in `ran` there. */
function newArc({ mac = false } = {}): Arc {
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
  // What a program run over ssh there has, besides arc's folders.
  const remote: Record<string, string> = { ...folders }
  if (mac) {
    mkdirSync(at("mac"))
    writeFileSync(at("mac/uname"), "#!/bin/sh\necho Darwin\n", { mode: 0o755 })
    const copy = at(`home/${MAC_COPY}`)
    mkdirSync(dirname(copy), { recursive: true })
    // The engine runs on this machine's PATH, not the one with arc's uname.
    writeFileSync(
      copy,
      `#!/bin/sh\necho "$0" >> "$HOME/ran"\nPATH=${quoted(process.env.PATH ?? "")} exec ${quoted(program)} "$@"\n`,
      { mode: 0o755 }
    )
    // Only arc's uname, and no banda-local of this machine's on its PATH.
    remote.HOME = at("home")
    remote.PATH = `${at("mac")}:/usr/bin:/bin`
  }
  writeFileSync(at("bin/ssh"), fakeSsh(remote), { mode: 0o755 })
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

/** arc's Threads in `project`, as its engine lists them. */
function threadsOf(arc: Arc, project: string) {
  const { ok } = JSON.parse(
    arc.banda("call", "agents.threads", "--project", project)
  ) as {
    ok: { threads: { id: string; title: string; latest?: { state: string } }[] }
  }
  return ok.threads
}

/** What arc's engine keeps of Thread `thread` in `project`, as JSON. */
const keptOf = (arc: Arc, project: string, thread: string) =>
  arc.banda(
    "call",
    "agents.thread",
    "--project",
    project,
    "--params",
    JSON.stringify({ thread })
  )

/** arc's Threads in `project`, each its title and how its turn stands. */
const states = (arc: Arc, project: string) =>
  threadsOf(arc, project).map((thread) => [thread.title, thread.latest?.state])

/** The window, its hosts.toml naming arc with `banda`, or with none
 * (`null`) for the window to find it there, and the fake ssh first on its
 * PATH. */
const withArc = (arc: Arc, banda: string | null = program) =>
  startWindow({
    look: 'mode = "dark"\n',
    sidebar: 'preset = "projects"\n',
    files: {
      "config/hosts.toml": `[[hosts]]\nname = "arc"\nssh = "arc"\n${banda ? `banda = ${JSON.stringify(banda)}\n` : ""}`,
    },
    env: { PATH: `${arc.bin}:${process.env.PATH}` },
  })

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
  await page.screenshot({ path: join(shots, `${name}.png`) })
}

test("another machine's Threads show under its name, below this one's; stopped there, Start brings it back", async () => {
  test.setTimeout(shots ? 300_000 : 120_000)
  arc = newArc()
  const banda = await seed(arc)
  window = await withArc(arc)
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
  await shot(page, "pr2-1-projects-live")
  // Its rows have no menu yet.
  await there.getByText("Bench window tests").click({ button: "right" })
  await expect(page.getByRole("menu", { name: "Thread menu" })).toHaveCount(0)
  await page.keyboard.press("Escape")

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
  await shot(page, "pr2-2-inbox-live")

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
    await shot(page, "pr2-3-away")
  }
  arc.down(false)
  await expect(there.getByText(/^away/)).toHaveCount(0, { timeout: 60_000 })
  await expect(there.getByText("Bench window tests")).toBeVisible()

  // Stopped there as asked: it says so, its rows go, and Start brings it
  // back.
  arc.banda("stop", "--force")
  await expect(there.getByText("stopped", { exact: true })).toBeVisible()
  await expect(there.getByText("Bench window tests")).toHaveCount(0)
  await shot(page, "pr2-4-stopped")
  await there.getByRole("button", { name: "Start" }).click()
  await expect(there.getByText("Bench window tests")).toBeVisible()
  await expect(there.getByText("stopped", { exact: true })).toHaveCount(0)
})

test("another machine's Thread opens from the sidebar on its engine, waits while arc is away and catches up; other Panes are not on arc yet", async () => {
  test.setTimeout(shots ? 300_000 : 120_000)
  arc = newArc()
  const banda = await seed(arc)
  window = await withArc(arc)
  const { page } = window
  await work(window)
  await expect(sidebarOf(page).getByText("Sidebar for arc")).toBeVisible()

  // A click opens it as a Thread of this machine's opens, read live from
  // arc's engine.
  await arcOf(page).getByText("Bench window tests").click()
  const thread = page.getByRole("region", {
    name: "Bench window tests",
    exact: true,
  })
  await expect(thread.getByText("You said: Bench window tests")).toBeVisible()
  // It writes there: arc's Agent answers.
  const composer = thread.getByRole("textbox", { name: "Message to Fake AI" })
  await composer.fill("hi")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hi")).toBeVisible()
  await expect
    .poll(() => states(arc!, banda))
    .toEqual([["Bench window tests", "done"]])
  // A turn that goes on stops from here.
  await composer.fill("wait for it")
  await composer.press("Enter")
  await expect(thread.getByText("Waiting.")).toBeVisible()
  await thread.getByRole("button", { name: "Stop", exact: true }).click()
  await expect
    .poll(() => states(arc!, banda))
    .toEqual([["Bench window tests", "stopped"]])
  await shot(page, "pr3-1-remote-thread")

  // The link drops, and arc's engine ends with it: the Pane says so,
  // and its Thread stays as it was. As arc is back, it reads it again and
  // writes there.
  arc.down(true)
  arc.cut()
  const away = page.getByRole("status").filter({ hasText: "arc is away" })
  await expect(away).toBeVisible()
  await expect(thread.getByText("You said: hi")).toBeVisible()
  await shot(page, "pr3-2-away")
  arc.down(false)
  await expect(away).toHaveCount(0, { timeout: 60_000 })
  await composer.fill("back again")
  await composer.press("Enter")
  await expect(thread.getByText("You said: back again")).toBeVisible()
  // arc's Agent answered it there, in the same Thread.
  await expect
    .poll(() => states(arc!, banda))
    .toEqual([["Bench window tests", "done"]])
  const [only] = threadsOf(arc!, banda)
  expect(keptOf(arc!, banda, only!.id)).toContain("You said: back again")
  // The window's arrangement keeps the Pane on arc: drawn anew, as after
  // a restart, it opens there again.
  await page.reload()
  await expect(thread.getByText("You said: back again")).toBeVisible()
  await thread.getByRole("textbox", { name: "Message to Fake AI" }).focus()

  // Any other Pane for arc's Project waits for a later step: none reads
  // this machine's files for it.
  await page.keyboard.press("Alt+KeyN")
  const other = page.getByRole("region", { name: "New Pane" })
  await expect(other.getByText("Not on arc yet")).toBeVisible()
  await expect(other.getByRole("button", { name: "Terminal" })).toHaveCount(0)
  await shot(page, "pr3-3-not-on-arc")
})

test("a Mac there, with no banda in hosts.toml: the window finds its Banda in the Mac's Application Support", async () => {
  arc = newArc({ mac: true })
  await seed(arc)
  window = await withArc(arc, null)
  const there = arcOf(window.page)
  await expect(there.getByText("Bench window tests")).toBeVisible()
  // It ran the copy a Mac keeps, as arc's uname said Darwin.
  expect(readFileSync(join(arc.dir, "home/ran"), "utf8")).toBe(
    `${join(arc.dir, "home", MAC_COPY)}\n`
  )
})

test("another machine's Thread that calls opens on its engine by Alt+U and from its toast, never on this one's", async () => {
  test.setTimeout(120_000)
  arc = newArc()
  const banda = await seed(arc)
  window = await withArc(arc)
  const { page } = window
  await work(window)
  const done = (title: string) =>
    sidebarOf(page)
      .getByRole("button", { name: new RegExp(title) })
      .getByRole("img", { name: "Done" })
  await expect(done("Sidebar for arc")).toBeVisible()
  await expect(done("Bench window tests")).toBeVisible()

  // Alt+U goes down what calls, this machine's first: then arc's Thread,
  // which opens read live from arc's engine.
  await page.keyboard.press("Alt+U")
  await expect(
    page.getByRole("region", { name: "Sidebar for arc", exact: true })
  ).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+U")
  const bench = page.getByRole("region", {
    name: "Bench window tests",
    exact: true,
  })
  await expect(bench).toHaveAttribute("data-focused", "true")
  await expect(bench.getByText("You said: Bench window tests")).toBeVisible()

  // One there that finishes out of sight tells with a toast, whose button
  // opens it there too.
  send(arc, banda, "Done on arc")
  const toast = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
    .filter({ hasText: "Done on arc" })
  await toast.getByRole("button", { name: "Open" }).click()
  const there = page.getByRole("region", { name: "Done on arc", exact: true })
  await expect(there).toHaveAttribute("data-focused", "true")
  await expect(there.getByText("You said: Done on arc")).toBeVisible()
  await expect(toast).toBeHidden()
})
