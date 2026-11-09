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
 * for the follower, as a Mac's does not (engine/src/control.rs).
 * hosts.toml applies as it changes: a machine written there by hand, or
 * added through the bridge as the page will, shows at once, and goes as
 * it is taken out, and its address changes in place; Test finds arc's
 * Banda, its system and its own name, and starts nothing there, and Stop
 * Banda stops it. arc names itself in its machine.toml (ADR 0095), as
 * this checkout's engine says in its welcome: "arc", a server. With
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
import { expect, type Locator, type Page, test } from "@playwright/test"
import type { Host } from "@banda/web/host"
import { headerShows, setInFront, startWindow, type Window } from "./window"

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
  writeFileSync(at("config/machine.toml"), 'name = "arc"\nicon = "server"\n')
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
    ok: {
      threads: {
        id: string
        title: string
        latest?: { state: string; turn: string }
        snooze?: { until?: number }
        seen?: string
        archived?: { at: number }
      }[]
    }
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

/** This machine's Project "Work", with a Thread done; its id. */
async function work(window: Window): Promise<string> {
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
  return project
}

/** A picture of the window for the Person, when they asked for them,
 * once the toasts have gone and the logo has done its move; the pointer
 * `at` a place where it hovers nothing. */
async function shot(page: Page, name: string, at = { x: 900, y: 700 }) {
  if (!shots) return
  await page.mouse.move(at.x, at.y)
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

  // Live: arc's label, its icon and the name it says it has, nothing
  // beside it, and its Project and Threads under it.
  const there = arcOf(page)
  const label = there.getByRole("heading", { name: "arc" })
  await expect(label).toBeVisible()
  await expect(label.locator('[data-machine-icon="server"]')).toBeVisible()
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
  // Its label's ⋯ folds it, opens the settings and stops Banda there. It
  // shows under the pointer, or as Tab reaches it: headless, nothing
  // hovers.
  const more = there.getByRole("button", { name: "arc menu" })
  await more.focus()
  await page.keyboard.press("Enter")
  const labelMenu = page.getByRole("menu")
  await expect(
    labelMenu.getByRole("menuitem", { name: "Machine settings" })
  ).toBeVisible()
  await expect(
    labelMenu.getByRole("menuitem", { name: "Stop Banda on arc" })
  ).toBeVisible()
  await shot(page, "label-menu")
  await labelMenu.getByRole("menuitem", { name: "Fold arc" }).click()
  await expect(there.getByText("Bench window tests")).toHaveCount(0)
  await more.focus()
  await page.keyboard.press("Enter")
  await page.getByRole("menuitem", { name: "Unfold arc" }).click()
  await expect(there.getByText("Bench window tests")).toBeVisible()

  // The Banda menu finds arc by its name, and names it on its Threads.
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await page.keyboard.press("Alt+Space")
  await menu.getByRole("combobox", { name: "Search" }).fill("arc")
  const machines = menu
    .getByRole("group", { name: "Machines" })
    .getByRole("option")
  await expect(machines).toHaveCount(1)
  await expect(machines).toContainText("Machine settings")
  await shot(page, "menu-machine")
  await menu.getByRole("combobox", { name: "Search" }).fill("bench")
  await expect(
    menu
      .getByRole("option")
      .filter({ hasText: "Bench window tests" })
      .locator('[data-machine-icon="server"]')
  ).toBeVisible()
  await shot(page, "menu-thread")
  await page.keyboard.press("Escape")

  // The Inbox: no label for a live host, and its rows among this
  // machine's, each with its host's name.
  writeFileSync(join(window.dir, "config/sidebar.toml"), 'preset = "inbox"\n')
  await expect(arcOf(page)).toHaveCount(0)
  const tags = sidebar.getByTitle("Its Agent works on arc")
  await expect(tags).toHaveCount(2)
  const mark = sidebar
    .getByRole("button")
    .filter({ hasText: "Bench window tests" })
    .getByTitle("Its Agent works on arc")
  await expect(mark).toHaveText("arc")
  await expect(mark.locator('[data-machine-icon="server"]')).toBeVisible()
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
  // Away, ssh would not reach it: its ⋯ has no Stop.
  await more.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menuitem", { name: "Fold arc" })).toBeVisible()
  await expect(
    page.getByRole("menuitem", { name: "Stop Banda on arc" })
  ).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await more.blur()
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

  // Stopped there from its label's ⋯: an Agent works there, so a toast
  // asks first, and Stop anyway stops it too. Stopped, it says so, its
  // rows go, and Start brings it back. arc's engine started again as the
  // link came back, so its Agent is given a turn that waits.
  send(arc, banda, "Hold arc, wait")
  await expect(
    there.getByRole("button").filter({ hasText: "Hold arc, wait" })
  ).toContainText(/\d:\d\d/)
  await more.focus()
  await page.keyboard.press("Enter")
  await page.getByRole("menuitem", { name: "Stop Banda on arc" }).click()
  const asks = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
    .filter({ hasText: "Agents work on arc" })
  await expect(asks).toBeVisible()
  await expect(there.getByText("stopped", { exact: true })).toHaveCount(0)
  if (shots) {
    // The toasts spread under the pointer, once the menu has gone.
    await expect(page.getByRole("menu")).toHaveCount(0)
    await asks.hover({ force: true })
    await page.waitForTimeout(1_000)
    await page.screenshot({ path: join(shots, "stop-asks.png") })
  }
  await asks.getByRole("button", { name: "Stop anyway" }).click()
  await expect(there.getByText("stopped", { exact: true })).toBeVisible()
  // Stopped, its ⋯ has no Stop, and no Fold: nothing is under it.
  await more.focus()
  await page.keyboard.press("Enter")
  await expect(
    page.getByRole("menuitem", { name: "Machine settings" })
  ).toBeVisible()
  await expect(
    page.getByRole("menuitem", { name: "Stop Banda on arc" })
  ).toHaveCount(0)
  await expect(page.getByRole("menuitem", { name: /^Fold/ })).toHaveCount(0)
  await page.keyboard.press("Escape")
  // Closed, the menu gives ⋯ the focus back; the picture has none.
  await expect(page.getByRole("menu")).toHaveCount(0)
  await more.blur()
  await expect(there.getByText("Bench window tests")).toHaveCount(0)
  await shot(page, "pr2-4-stopped")
  await there.getByRole("button", { name: "Start" }).click()
  await expect(there.getByText("Bench window tests")).toBeVisible()
  await expect(there.getByText("stopped", { exact: true })).toHaveCount(0)

  // Renamed there, by hand in its machine.toml: the label says it at once.
  writeFileSync(
    join(arc.dir, "config/machine.toml"),
    'name = "Studio"\nicon = "tower"\n'
  )
  const studio = sidebar.getByRole("group", { name: "Studio", exact: true })
  await expect(
    studio
      .getByRole("heading", { name: "Studio" })
      .locator('[data-machine-icon="tower"]')
  ).toBeVisible()
  await expect(studio.getByText("Bench window tests")).toBeVisible()
})

test("another machine's Thread opens from the sidebar on its engine, waits while arc is away and catches up; other Panes are not on arc yet", async () => {
  test.setTimeout(shots ? 300_000 : 120_000)
  arc = newArc()
  const banda = await seed(arc)
  window = await withArc(arc)
  const { page } = window
  const local = await work(window)
  await expect(sidebarOf(page).getByText("Sidebar for arc")).toBeVisible()

  // A click opens it as a Thread of this machine's opens, read live from
  // arc's engine.
  await arcOf(page).getByText("Bench window tests").click()
  const thread = page.getByRole("region", {
    name: "Bench window tests",
    exact: true,
  })
  await expect(thread.getByText("You said: Bench window tests")).toBeVisible()
  // Its header names arc after its Project, before its title.
  await expect(
    thread.locator('[data-machine-icon="server"]').first()
  ).toBeVisible()
  expect(await headerShows(thread)).toEqual([
    "mark",
    "project",
    "machine",
    "Bench window tests",
    "buttons",
  ])
  // It writes there, and its composer says so: arc's Agent answers.
  const composer = thread.getByRole("textbox", { name: "Message to Fake AI" })
  await expect(composer).toHaveAttribute(
    "aria-placeholder",
    "Write to Fake AI on arc. @ files, / commands, $ skills"
  )
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
  // and its Thread stays as it was. Send waits and says why, Enter sends
  // nothing, and what is written stays. As arc is back, it reads it again
  // and writes there.
  arc.down(true)
  arc.cut()
  const away = page.getByRole("status").filter({ hasText: "arc is away" })
  await expect(away).toBeVisible()
  await expect(thread.getByText("You said: hi")).toBeVisible()
  await composer.fill("back again")
  const sending = thread.getByRole("button", { name: "Send", exact: true })
  await expect(sending).toBeDisabled()
  await expect(sending).toHaveAttribute(
    "title",
    "arc is away. Send once it is back."
  )
  // Held, it still takes the pointer, so its tooltip shows.
  await sending.hover({ timeout: 5_000 })
  await composer.press("Enter")
  await expect(composer).toHaveText("back again")
  await expect(sending).toBeDisabled()
  await shot(page, "pr3-2-away")
  arc.down(false)
  await expect(away).toHaveCount(0, { timeout: 60_000 })
  // The engine connects again on its own wait, which may end after the
  // pill has gone: Send waits for it, the draft still there.
  await expect(sending).toBeEnabled({ timeout: 60_000 })
  await expect(sending).not.toHaveAttribute("title")
  await expect(composer).toHaveText("back again")
  await composer.press("Enter")
  await expect(thread.getByText("You said: back again")).toBeVisible()
  await expect(composer).toHaveText("")
  // arc's Agent answered it there, in the same Thread.
  await expect
    .poll(() => states(arc!, banda))
    .toEqual([["Bench window tests", "done"]])
  const [only] = threadsOf(arc!, banda)
  expect(keptOf(arc!, banda, only!.id)).toContain("You said: back again")
  // Once: nothing went while arc was away.
  await expect(thread.getByText("You said: back again")).toHaveCount(1)
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
  await expect(
    other
      .locator("p", { hasText: "Not on arc yet" })
      .locator('[data-machine-icon="server"]')
  ).toBeVisible()
  await expect(other.getByRole("button", { name: "Terminal" })).toHaveCount(0)
  // Its header names arc after its icon and title: it names no Project.
  expect(await headerShows(other)).toEqual([
    "",
    "New Pane",
    "machine",
    "buttons",
  ])
  await shot(page, "pr3-3-not-on-arc")

  // Alt+Z on arc's Thread snoozes it on arc's engine, as its Pane is
  // there (#797): its Pane closes, and this machine's Thread stays awake.
  await thread.getByRole("textbox", { name: "Message to Fake AI" }).focus()
  await page.keyboard.press("Alt+KeyZ")
  const picker = page.getByRole("dialog").filter({ hasText: "Snooze ·" })
  await expect(picker).toContainText("Bench window tests")
  const field = picker.getByRole("textbox", { name: "When it comes back" })
  await expect(field).toBeFocused()
  await field.fill("2h")
  await field.press("Enter")
  await expect(thread).toBeHidden()
  await expect
    .poll(() => threadsOf(arc!, banda)[0]?.snooze?.until ?? 0)
    .toBeGreaterThan(Date.now())
  const { ok } = JSON.parse(
    window.banda("call", "agents.threads", "--project", local)
  ) as { ok: { threads: { title: string; snooze?: object }[] } }
  expect(ok.threads.map(({ title, snooze }) => [title, snooze])).toEqual([
    ["Sidebar for arc", undefined],
  ])
})

test("another machine's Thread is seen, marked unread and archived on its engine, from its Pane, and never on this one's (ADR 0096)", async () => {
  arc = newArc()
  const banda = await seed(arc)
  window = await withArc(arc)
  const { page } = window
  const local = await work(window)
  await expect(sidebarOf(page).getByText("Sidebar for arc")).toBeVisible()
  const bench = () => threadsOf(arc!, banda)[0]!
  expect(bench().seen).toBeUndefined()
  const row = arcOf(page)
    .getByRole("button")
    .filter({ hasText: "Bench window tests" })
  const done = row.getByRole("img", { name: "Done" })
  await expect(done).toBeVisible()

  // Opened, it is seen there, as its Person looks at it.
  await row.click()
  const thread = page.getByRole("region", {
    name: "Bench window tests",
    exact: true,
  })
  await expect(thread.getByText("You said: Bench window tests")).toBeVisible()
  await expect.poll(() => bench().seen).toBe(bench().latest!.turn)
  await expect(done).toBeHidden()

  // Mark as unread, from its Pane's menu: on arc's engine.
  await thread
    .locator("header")
    .getByRole("button", { name: "Bench window tests", exact: true })
    .click()
  await page.getByRole("menuitem", { name: /Mark as unread/ }).click()
  await expect(done).toBeVisible()
  await expect.poll(() => bench().seen).toBeUndefined()
  // Alt+S archives it there, and its Pane closes once arc took it.
  await thread.getByRole("textbox", { name: "Message to Fake AI" }).focus()
  await page.keyboard.press("Alt+S")
  await expect(thread).toBeHidden()
  await expect.poll(() => bench().archived).toBeDefined()
  // This machine's engine was sent none of it: its Thread is as it was,
  // and no toast says it knows no such Thread.
  const { ok } = JSON.parse(
    window.banda("call", "agents.threads", "--project", local)
  ) as {
    ok: { threads: { title: string; seen?: string; archived?: object }[] }
  }
  expect(
    ok.threads.map(({ title, seen, archived }) => [title, seen, archived])
  ).toEqual([["Sidebar for arc", undefined, undefined]])
  await expect(
    page
      .getByRole("region", { name: "Notifications" })
      .getByText("There is no such Thread.")
  ).toHaveCount(0)
})

test("a new Thread's Project picker groups the Projects by machine; one started in arc's Project starts on arc's engine, arc's No Project too, and away arc stays to pick", async () => {
  test.setTimeout(shots ? 300_000 : 180_000)
  arc = newArc()
  const banda = await seed(arc)
  window = await withArc(arc)
  const { page } = window
  const local = await work(window)
  const sidebar = sidebarOf(page)
  await expect(arcOf(page).getByText("Bench window tests")).toBeVisible()
  await page
    .getByRole("region", { name: "New Thread" })
    .getByRole("button", { name: "Close New Thread", exact: true })
    .click()
  const draft = page
    .getByRole("region", { name: "New Thread" })
    .and(page.locator('[data-focused="true"]'))
  const menu = page.getByRole("menu")
  const choices = () => menu.getByRole("menuitemradio")
  const arcPart = menu.getByRole("group", { name: /^arc/ })
  // Where the pointer hovers none of the picker's rows in a picture.
  const ASIDE = { x: 1200, y: 200 }

  // One in Work: its picker lists this machine's Projects with no label,
  // then arc's under its label, as the sidebar does.
  const newInWork = sidebar.getByRole("button", { name: "New Thread in Work" })
  await newInWork.click()
  await draft.getByRole("button", { name: "Project: Work" }).click()
  await expect(choices()).toHaveText([
    /No Project/,
    /Work/,
    /No Project/,
    /banda/,
  ])
  await expect(arcPart.getByRole("menuitemradio")).toHaveText([
    /No Project/,
    /banda/,
  ])
  await expect(arcPart.locator('[data-machine-icon="server"]')).toBeVisible()
  await expect(arcPart.getByText("away", { exact: true })).toHaveCount(0)
  await expect(
    menu.getByRole("menuitem", { name: "Add Project" })
  ).toBeVisible()
  await shot(page, "step4c-1-picker", ASIDE)

  // Picked, arc's banda opens it on arc: its header names arc, as every
  // Pane of arc's does, and its button after the Project.
  await arcPart.getByRole("menuitemradio", { name: /^banda/ }).click()
  const onArc = draft.getByRole("button", { name: "Project: banda on arc" })
  await expect(onArc).toBeVisible()
  await expect(onArc.locator('[data-machine-icon="server"]')).toBeVisible()
  expect(await headerShows(draft)).toEqual([
    "",
    "New Thread",
    "machine",
    "buttons",
  ])
  // It writes to arc's Agent, and says so.
  const composer = draft.getByRole("textbox", { name: "Message to Fake AI" })
  await expect(composer).toHaveAttribute(
    "aria-placeholder",
    "Write to Fake AI on arc. @ files, / commands, $ skills"
  )
  await expect(
    draft.getByText("Write to Fake AI on arc", { exact: true })
  ).toBeVisible()
  await shot(page, "step4c-2-on-arc")
  // Sent, it is arc's Thread, on arc's Agent, and none of this machine's.
  await composer.fill("Started on arc")
  await composer.press("Enter")
  const started = page.getByRole("region", {
    name: "Started on arc",
    exact: true,
  })
  await expect(started.getByText("You said: Started on arc")).toBeVisible()
  await expect
    .poll(() => states(arc!, banda))
    .toContainEqual(["Started on arc", "done"])
  const ours = JSON.parse(
    window.banda("call", "agents.threads", "--project", local)
  ) as { ok: { threads: { title: string }[] } }
  expect(ours.ok.threads.map((one) => one.title)).toEqual(["Sidebar for arc"])
  await expect(
    arcOf(page).getByRole("button").filter({ hasText: "Started on arc" })
  ).toBeVisible()

  // arc's No Project: its first message makes its folder there.
  await newInWork.click()
  await draft.getByRole("button", { name: "Project: Work" }).click()
  await arcPart.getByRole("menuitemradio", { name: /^No Project/ }).click()
  await expect(
    draft.getByRole("button", { name: "Project: No Project on arc" })
  ).toBeVisible()
  const scratch = draft.getByRole("textbox", { name: "Message to Fake AI" })
  await scratch.fill("Scratch on arc")
  await scratch.press("Enter")
  await expect(
    page
      .getByRole("region", { name: "Scratch on arc", exact: true })
      .getByText("You said: Scratch on arc")
  ).toBeVisible()
  const made = () =>
    (
      JSON.parse(arc!.banda("call", "projects.list")) as {
        ok: { id: string; scratch: boolean }[]
      }
    ).ok.filter((one) => one.scratch)
  await expect.poll(() => made().length).toBe(1)
  await expect
    .poll(() => states(arc!, made()[0]!.id))
    .toEqual([["Scratch on arc", "done"]])

  // arc goes away with the picker open: its part stays, marked away,
  // still one to pick, as Send waits there.
  await newInWork.click()
  await draft.getByRole("button", { name: "Project: Work" }).click()
  await expect(arcPart.getByRole("menuitemradio")).toHaveCount(2)
  arc.down(true)
  arc.cut()
  await expect(arcPart.getByText("away", { exact: true })).toBeVisible()
  await expect(arcPart.getByRole("menuitemradio")).toHaveText([
    /No Project/,
    /banda/,
  ])
  await shot(page, "step4c-3-away", ASIDE)
  // Picked while away, it waits for arc: the window says arc is away,
  // and Send holds what is written until arc is back.
  await arcPart.getByRole("menuitemradio", { name: /^banda/ }).click()
  await expect(onArc).toBeVisible()
  await expect(
    draft.getByRole("status").filter({ hasText: "arc is away" })
  ).toBeVisible()
  const held = draft.getByRole("textbox", { name: /^Message to / })
  await expect(held).toHaveAttribute(
    "aria-placeholder",
    /^Write to .* on arc\. /
  )
  await held.fill("Waits for arc")
  const sending = draft.getByRole("button", { name: "Send", exact: true })
  await expect(sending).toBeDisabled()
  await expect(sending).toHaveAttribute(
    "title",
    "arc is away. Send once it is back."
  )
  await shot(page, "step4c-3b-picked-away")
  arc.down(false)
  await expect(arcOf(page).getByText(/^away/)).toHaveCount(0, {
    timeout: 60_000,
  })

  // On arc, its picker lists this machine's Projects first, and adds none
  // there.
  await onArc.click()
  await expect(choices()).toHaveText([
    /No Project/,
    /Work/,
    /No Project/,
    /banda/,
  ])
  await expect(
    arcPart.getByRole("menuitemradio", { name: /^banda/ })
  ).toHaveAttribute("aria-checked", "true")
  await expect(menu.getByRole("menuitem", { name: "Add Project" })).toHaveCount(
    0
  )
  await shot(page, "step4c-4-arc-pane", ASIDE)
  // This machine's No Project, picked there, is this machine's again.
  await menu
    .getByRole("menuitemradio", { name: /^No Project/ })
    .first()
    .click()
  await expect(
    draft.getByRole("button", { name: "Project: No Project", exact: true })
  ).toBeVisible()
  expect(await headerShows(draft)).not.toContain("machine")
  await expect(
    draft.getByRole("textbox", { name: "Message to Fake AI" })
  ).toHaveAttribute("aria-placeholder", /^Write to Fake AI\. /)
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
  // opens it there too. Where the focus ends is not said: the toasts give
  // it back to the Pane that had it, drawn beside (#831).
  send(arc, banda, "Done on arc")
  const toast = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
    .filter({ hasText: "Done on arc" })
  await toast.getByRole("button", { name: "Open" }).click()
  const there = page.getByRole("region", { name: "Done on arc", exact: true })
  await expect(there.getByText("You said: Done on arc")).toBeVisible()
  await expect(toast).toBeHidden()
})

/** The page's global, with the bridge on it. */
type Paged = { banda: Host }

test("hosts.toml applies as it changes: a machine added by hand or through the bridge shows at once; Test starts nothing there, Stop Banda stops it, Remove takes it out", async () => {
  test.setTimeout(120_000)
  arc = newArc()
  await seed(arc)
  window = await startWindow({
    look: 'mode = "dark"\n',
    sidebar: 'preset = "projects"\n',
    env: { PATH: `${arc.bin}:${process.env.PATH}` },
  })
  const { page } = window
  const file = join(window.dir, "config/hosts.toml")
  const entry = `[[hosts]]\nname = "arc"\nssh = "arc"\nbanda = ${JSON.stringify(program)}\n`
  const there = arcOf(page)
  const tested = () =>
    page.evaluate(
      (banda) => (globalThis as unknown as Paged).banda.hostTest("arc", banda),
      program
    )
  await expect(sidebarOf(page)).toBeVisible()

  // Test, before arc is added: its Banda is found, with the system it
  // runs and its own name and icon, and its engine, which does not run,
  // is not started.
  expect(await tested()).toMatchObject({
    state: "found",
    system: expect.stringMatching(/\S/),
    named: { name: "arc", icon: "server" },
    engine: null,
  })
  expect(JSON.parse(arc.banda("status"))).toMatchObject({ running: false })

  // Written by hand: arc shows, with no restart.
  writeFileSync(file, entry)
  await expect(there.getByText("Bench window tests")).toBeVisible()
  expect(await tested()).toMatchObject({
    state: "found",
    engine: { speaks: true },
  })

  // Stop Banda on arc: its engine stops, and the label says so.
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as Paged).banda.hostStop("arc", false)
    )
  ).toBe("stopped")
  await expect(there.getByText("stopped", { exact: true })).toBeVisible()

  // Taken out through the bridge: arc goes, and the file is empty.
  await page.evaluate(() =>
    (globalThis as unknown as Paged).banda.hostRemove("arc")
  )
  await expect(there).toHaveCount(0)
  expect(readFileSync(file, "utf8")).toBe("")

  // Added through the bridge: written, and shown at once.
  expect(
    await page.evaluate(
      (banda) =>
        (globalThis as unknown as Paged).banda.hostAdd({ ssh: "arc", banda }),
      program
    )
  ).toEqual({ name: "arc", ssh: "arc", banda: program })
  expect(readFileSync(file, "utf8")).toBe(entry)
  await expect(there.getByText("Bench window tests")).toBeVisible()

  // Its address changed through the bridge: written in place, and arc is
  // reached again at it.
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as Paged).banda.hostSet("arc", {
        ssh: "roma@arc",
      })
    )
  ).toEqual({ name: "arc", ssh: "roma@arc", banda: program })
  expect(readFileSync(file, "utf8")).toBe(
    entry.replace('ssh = "arc"', 'ssh = "roma@arc"')
  )
  await expect(there.getByText("Bench window tests")).toBeVisible()
  // The same machine again, at another address, is refused.
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as Paged).banda
        .hostAdd({ ssh: "arc" })
        .then(String, (error: Error) => error.message)
    )
  ).toMatch(/arc is in hosts.toml already/)
})

/** A picture of Settings → Machines for the Person, when they asked for
 * them, named `step5-…`, as the mock's (ADR 0095, plan step 5). */
async function settingsShot(page: Page, name: string) {
  if (!shots) return
  // Once the Tiling has moved to the settings.
  await page.mouse.move(1270, 790)
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: join(shots, `step5-${name}.png`) })
}

/** Scrolls the settings' own scroller, and nothing around it, so all of
 * `target` shows: an element's own scrolling into view would move the
 * Tiling sideways too. */
async function settingsScrolledTo(target: Locator) {
  await target.evaluate((element) => {
    for (let at = element.parentElement; at; at = at.parentElement) {
      const { overflowY } = getComputedStyle(at)
      if (overflowY !== "auto" && overflowY !== "scroll") continue
      const view = at.getBoundingClientRect()
      const { top, bottom } = element.getBoundingClientRect()
      if (bottom > view.bottom) at.scrollTop += bottom - view.bottom + 16
      else if (top < view.top) at.scrollTop -= view.top - top + 16
      return
    }
  })
}

test("Settings → Machines: this machine names itself, arc is renamed on arc, tested, away, removed, and added again, numbered past a name and an icon shown", async () => {
  test.setTimeout(shots ? 300_000 : 180_000)
  arc = newArc()
  await seed(arc)
  // Banda's own, as a Person's PATH would have it there: Add's Connect
  // and the follower find it with no `banda` in hosts.toml.
  writeFileSync(
    join(arc.bin, "banda-local"),
    `#!/bin/sh\nexec ${quoted(program)} "$@"\n`,
    { mode: 0o755 }
  )
  window = await startWindow({
    look: 'mode = "dark"\n',
    sidebar: 'preset = "projects"\n',
    files: {
      "config/hosts.toml": `[[hosts]]\nname = "arc"\nssh = "arc"\nbanda = ${JSON.stringify(program)}\n`,
      "config/machine.toml": 'name = "m1pro"\nicon = "laptop"\n',
    },
    env: { PATH: `${arc.bin}:${process.env.PATH}` },
  })
  const { app, page } = window
  // The Hosts of an ssh config, whatever the machine's own says.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("sshSuggestions")
    ipcMain.handle("sshSuggestions", () => ["arc", "devbox", "pi5"])
  })
  const hostsFile = join(window.dir, "config/hosts.toml")
  const ours = join(window.dir, "config/machine.toml")
  const arcs = join(arc.dir, "config/machine.toml")
  await expect(arcOf(page).getByText("Bench window tests")).toBeVisible()

  // This machine: its name, its icon and what it is, Banda's build too.
  await page.keyboard.press("Alt+Comma")
  const settings = page.getByRole("region", { name: "Settings", exact: true })
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: /Machines/ })
    .click()
  // The pictures take the settings as wide as their column goes, as the
  // mock draws them.
  if (shots) await page.keyboard.press("Alt+KeyF")
  const here = settings.getByRole("group", { name: "This machine" })
  await expect(
    here.getByRole("textbox", { name: "This machine's name" })
  ).toHaveValue("m1pro")
  await expect(here.locator('[data-machine-icon="laptop"]')).toBeVisible()
  await expect(here).toContainText(/Banda \S/)
  await settingsShot(page, "1-this-machine")

  // The Banda menu's Machine settings opens arc's row, where Test finds
  // arc, its system and its own name.
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await page.keyboard.press("Alt+Space")
  await menu.getByRole("combobox", { name: "Search" }).fill("arc")
  await menu
    .getByRole("group", { name: "Machines" })
    .getByRole("option")
    .click()
  const row = settings.locator('[data-key="arc"]')
  await expect(row.getByRole("button", { expanded: true })).toBeVisible()
  await expect(row.getByRole("textbox", { name: "arc's address" })).toHaveValue(
    "arc"
  )
  await expect(row.getByRole("textbox", { name: "Banda on arc" })).toHaveValue(
    program
  )
  await expect(row).toContainText("same as here")
  await expect(
    row.getByRole("button", { name: "Stop Banda on arc" })
  ).toBeVisible()
  await row.getByRole("button", { name: "Test connection" }).click()
  await expect(row.getByRole("status")).toContainText(/^Found arc · \S/)
  // The menu gave the focus back to the Pane that had it before, and the
  // Tiling shows that one: back to the settings by the keys, as the
  // Person would.
  if (shots) {
    await page.keyboard.press("Alt+ArrowLeft")
    await page.keyboard.press("Alt+ArrowRight")
    await settingsScrolledTo(row.getByRole("status"))
  }
  await settingsShot(page, "2-other")

  // Renamed on arc: its machine.toml has it, and the sidebar's label
  // follows. m1pro's laptop is greyed, and still taken.
  await row.getByRole("button", { name: "Edit" }).click()
  const icons = page.getByRole("radiogroup", { name: "Machine icon" })
  const icon = (name: string) =>
    icons.getByRole("radio", { name: `A ${name}`, exact: true })
  await expect(icon("laptop")).toHaveAttribute("data-taken", "true")
  await expect(icon("server")).toBeChecked()
  await settingsShot(page, "3-picker")
  const name = page.getByRole("textbox", { name: "Machine name" })
  await name.fill("Studio")
  await name.press("Enter")
  await icon("tower").click()
  await expect
    .poll(() => readFileSync(arcs, "utf8"))
    .toMatch(/name = "Studio"\nicon = "tower"/)
  const studio = sidebarOf(page).getByRole("group", {
    name: "Studio",
    exact: true,
  })
  await expect(
    studio.getByRole("heading").locator('[data-machine-icon="tower"]')
  ).toBeVisible()
  // And back, for what follows.
  await name.fill("arc")
  await name.press("Enter")
  await icon("server").click()
  await expect
    .poll(() => readFileSync(arcs, "utf8"))
    .toMatch(/name = "arc"\nicon = "server"/)
  await page.keyboard.press("Escape")
  await expect(arcOf(page)).toBeVisible()

  // Away, it is renamed only once it is back.
  arc.down(true)
  arc.cut()
  await expect(row.getByRole("button", { expanded: true })).toContainText(
    "away"
  )
  await expect(row.getByRole("button", { name: "Edit" })).toBeDisabled()
  await expect(row).toContainText("Rename arc when it is back.")
  await expect(
    row.getByRole("button", { name: "Stop Banda on arc" })
  ).toHaveCount(0)
  await settingsShot(page, "4-away")
  arc.down(false)
  await expect(row.getByRole("button", { expanded: true })).toContainText(
    "live · same build",
    { timeout: 60_000 }
  )

  // Renamed by hand on arc, as two VMs both "Cloud": the window follows.
  writeFileSync(arcs, 'name = "Cloud"\nicon = "server"\n')
  const cloud = sidebarOf(page).getByRole("group", {
    name: "Cloud",
    exact: true,
  })
  await expect(cloud.getByText("Bench window tests")).toBeVisible()

  // Remove… asks first; its Projects stay there.
  await row.getByRole("button", { name: "Remove…" }).click()
  const removing = page.getByRole("dialog", { name: "Remove Cloud?" })
  await expect(removing).toContainText("Its Projects stay on Cloud.")
  await settingsShot(page, "6-remove")
  await removing.getByRole("button", { name: "Remove Cloud" }).click()
  await expect(row).toHaveCount(0)
  await expect(cloud).toHaveCount(0)
  expect(readFileSync(hostsFile, "utf8")).toBe("")

  // This machine renamed and drawn as a server, on its own machine.toml.
  const ourName = here.getByRole("textbox", { name: "This machine's name" })
  await ourName.fill("Cloud")
  await ourName.press("Enter")
  await here.getByRole("button", { name: "Change this machine's icon" }).click()
  await icon("server").click()
  await expect
    .poll(() => readFileSync(ours, "utf8"))
    .toMatch(/name = "Cloud"\nicon = "server"/)
  await page.keyboard.press("Escape")

  // Add a machine: a chip of the ssh config connects, and finds it, with
  // what Add will write there.
  const adding = settings.getByRole("group", { name: "From ~/.ssh/config" })
  await expect(adding.getByRole("button")).toHaveText(["arc", "devbox", "pi5"])
  await adding.getByRole("button", { name: "arc" }).click()
  const found = settings.getByRole("status").filter({ hasText: "Found" })
  await expect(found).toContainText(/Found Cloud · \S/)
  await expect(found).toContainText(
    "Cloud is taken, so Add names the new machine Cloud 2 and writes that on it."
  )
  await expect(found).toContainText(
    "Cloud has the server icon, so Add gives the new machine the tower."
  )
  await settingsShot(page, "5-add")
  await found.getByRole("button", { name: "Add" }).click()

  // Listed, numbered and moved on, on arc itself, and the Person is told.
  await expect
    .poll(() => readFileSync(hostsFile, "utf8"))
    .toBe('[[hosts]]\nname = "arc"\nssh = "arc"\n')
  await expect
    .poll(() => readFileSync(arcs, "utf8"))
    .toMatch(/name = "Cloud 2"\nicon = "tower"/)
  // Its row opens, as the link still names arc.
  const header = row.getByRole("button", { expanded: true })
  await expect(header).toContainText("Cloud 2")
  await expect(header.locator('[data-machine-icon="tower"]')).toBeVisible()
  await expect(settings).toContainText(
    "Added Cloud 2. Written on it: the name Cloud 2 and the tower icon. Change it in its row."
  )
  await expect(
    sidebarOf(page)
      .getByRole("group", { name: "Cloud 2", exact: true })
      .getByText("Bench window tests")
  ).toBeVisible()
})
