/**
 * Another machine's Threads in the sidebar (ADR 0081, decision 4): the
 * window reaches a second engine, "arc", over ssh. Here ssh is a fake
 * first on the window's PATH: it runs arc's `banda start --with-parent`
 * on this machine, on arc's own folders, and forwards the port itself, as
 * ssh does, so main's check that ssh holds the port holds. arc's label
 * shows below this machine's Projects, with its Projects and Threads;
 * stopped there, it says so, and Start brings it back. Its Thread opens
 * from the sidebar on arc's engine, and waits while arc is away: Send
 * says why in the pill's words, from the window's start, and turns on as
 * arc is back. In a started Thread it reads Send when back instead: the
 * message waits at the Thread's end, counted in the pill, and goes once
 * as arc is back, or past its time comes back into the draft (ADR 0105).
 * Alt+U and a toast open one there too, as `pane.pick` keeps
 * its host, and a toast for one names arc, and its Allow and Try again go
 * to arc's engine, or are refused at once while arc is away. So is Stop
 * on its Thread, in a toast that names arc, and nothing goes there once
 * it is back; a Stop on its way as arc goes says it may have gone
 * through. arc that answers nothing, its link up, is away in seconds as
 * well, its rows dim and the foot's machines say since when it was last
 * heard, and stopped it keeps its rows too. The counts
 * list and Alt+U place its Threads where the sidebar list does, among
 * this machine's. A new Thread's picker groups
 * the Projects by machine, in a popped-out Pane's window as in the
 * window; one moved from arc to this machine's Project never names arc,
 * not for a frame, and starts its Thread here. As a Mac, its `uname` says
 * Darwin, and the window finds its Banda in its Application Support; its
 * engine is this checkout's still, which serves for the follower, as a
 * Mac's does not
 * (engine/src/control.rs).
 * hosts.toml applies as it changes: a machine written there by hand, or
 * added through the bridge as the page will, shows at once, and goes as
 * it is taken out, and its address changes in place; Test finds arc's
 * Banda, its system and its own name, and starts nothing there, and Stop
 * Banda stops it. arc names itself in its machine.toml (ADR 0095), as
 * this checkout's engine says in its welcome: "arc", a server. In
 * Settings → Machines a row stays busy while any of its acts runs, as a
 * Test main holds outlasts an address refused meanwhile. arc says its
 * battery while it is live, in its row and its label's card (ADR 0097):
 * as its engine is this machine's, the runner's, so a laptop's shows and
 * CI's none. With BANDA_E2E_SHOTS set to a folder, it leaves pictures of
 * each state there for the Person to see.
 */
import { execFileSync, spawn } from "node:child_process"
import { once } from "node:events"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import type { Host } from "../src/bridge"
import {
  bandaMenu,
  headerShows,
  leaveSidebar,
  newThreadIn,
  placeOf,
  startWindow,
  type Window,
} from "./window"

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

/** A card's time, short and still (ADR 0098, decision 8): "now", "40s",
 * "14m". */
const SHORT_TIME = /(now|\d+[smhd])$/

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
  /** The forward carries nothing while `on`, its link up all the same, as
   * an engine that hangs or a link gone dead without a word: arc answers
   * nothing, and hears nothing. What either side said meanwhile goes on
   * once it is let go. */
  hush: (on: boolean) => void
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
    BANDA_AUTO_TITLE: "off",
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
    hush: (on) =>
      process.kill(
        Number(readFileSync(at("bin/forward.pid"), "utf8")),
        on ? "SIGSTOP" : "SIGCONT"
      ),
    close: () => {
      try {
        // A forward held still would outlive the window's end.
        process.kill(
          Number(readFileSync(at("bin/forward.pid"), "utf8")),
          "SIGCONT"
        )
      } catch {
        // None runs.
      }
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

/** A machine's Threads in `project`, as its engine lists them: arc's, or
 * the window's own. */
function threadsOf(on: Pick<Arc, "banda">, project: string) {
  const { ok } = JSON.parse(
    on.banda("call", "agents.threads", "--project", project)
  ) as {
    ok: {
      threads: {
        id: string
        title: string
        latest?: { state: string; turn: string }
        later?: { until?: number }
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

/** A machine's Threads in `project`, each its title and how its turn
 * stands. */
const states = (on: Pick<Arc, "banda">, project: string) =>
  threadsOf(on, project).map((thread) => [thread.title, thread.latest?.state])

/** arc's engine, started apart from the window's ssh, as a service
 * there is: the window's ssh follows it, and the link's going leaves it
 * running, its Agents' turns with it. How to stop it. */
async function held(arc: Arc): Promise<() => Promise<void>> {
  const engine = spawn(program, ["start", "--with-parent"], {
    env: arc.env,
    stdio: ["pipe", "pipe", "inherit"],
  })
  await once(engine.stdout, "data")
  return async () => {
    if (engine.exitCode !== null) return
    engine.stdin.end()
    await once(engine, "close")
  }
}

/** The window, its hosts.toml naming arc with `banda`, or with none
 * (`null`) for the window to find it there, and the fake ssh first on its
 * PATH; in `dir`, a window's folder before, it opens again on what that
 * window left. Its sidebar.toml is `sidebar`, grouped by Project unless
 * a test says otherwise. With `latency`, it hears each engine that many
 * ms late, as from far away. */
const withArc = (
  arc: Arc,
  banda: string | null = program,
  dir?: string,
  sidebar = 'preset = "projects"\n',
  latency = 0
) =>
  startWindow({
    look: 'mode = "dark"\n',
    sidebar,
    files: {
      "config/hosts.toml": `[[hosts]]\nname = "arc"\nssh = "arc"\n${banda ? `banda = ${JSON.stringify(banda)}\n` : ""}`,
    },
    env: { PATH: `${arc.bin}:${process.env.PATH}` },
    dir,
    latency,
  })

const sidebarOf = (page: Page) =>
  page.getByRole("complementary", { name: "Sidebar" })

/** Whether this machine has a battery of its own, as its engine finds it
 * on Linux and macOS: arc's engine runs here, so arc says this machine's.
 * CI's runners have none. */
function batteryHere(): boolean {
  if (process.platform === "darwin") {
    let said: string
    try {
      said = execFileSync("pmset", ["-g", "batt"], {
        encoding: "utf8",
        timeout: 5000,
      })
    } catch {
      return false
    }
    const line = said.split("\n").find((one) => one.includes("InternalBattery"))
    return line !== undefined && !line.includes("present: false")
  }
  if (process.platform !== "linux") return false
  const supplies = "/sys/class/power_supply"
  const read = (path: string) => {
    try {
      return readFileSync(join(supplies, path), "utf8").trim()
    } catch {
      return ""
    }
  }
  try {
    return readdirSync(supplies).some(
      (one) =>
        read(`${one}/type`) === "Battery" && read(`${one}/scope`) !== "Device"
    )
  } catch {
    return false
  }
}

/** What the window says of a battery in full (ADR 0097, decision 7). */
const BATTERY =
  /^\d+% · (on battery|charging|on power)( · \d+:\d\d (left|to full))?$/

/** The card a machine's label or mark opens as the pointer rests on it. */
const cardOf = (page: Page, name = "arc") =>
  page.getByRole("group", { name: `${name} facts` })

/** arc's part of the sidebar: its label and what it holds. */
const arcOf = (page: Page) =>
  sidebarOf(page).getByRole("group", { name: "arc", exact: true })

/** arc's dot in the sidebar's foot (ADR 0098, decision 18): how it
 * stands, and in its tooltip how long it has been out of reach. */
const dotOf = (page: Page) =>
  sidebarOf(page).locator('[data-machine-dot="arc"]')
/** What arc's dot says away: since when the window last heard it, by a
 * card's short steps. */
const AWAY = /^arc · away( \d+[smhd])?$/
/** What arc's dot says stopped. */
const STOPPED = /^arc · stopped( \d+[smhd])?$/

/** Whether arc's dot says the window reaches it: `live`, or `away`. */
const stands = (page: Page, standing: "live" | "away", timeout?: number) =>
  expect(dotOf(page)).toHaveAttribute("data-standing", standing, { timeout })

/** What a machine holds, dim, while the window does not reach it: its
 * cards. */
const dimmed = (part: Locator) => part.locator("[data-card][data-away]")

/** Why arc stands as it does, as its row in the foot's machines says it
 * in its tooltip: "arc has not answered since 14:02". */
async function machineWhy(page: Page): Promise<string> {
  await sidebarOf(page)
    .getByRole("button", { name: /^Machines: / })
    .click()
  // By its key: this machine may be named arc too, as its host is.
  const row = page
    .getByRole("dialog", { name: "Machines" })
    .locator('[data-machine="arc"]')
  const why = (await row.locator("[data-machine-words]").getAttribute("title"))!
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Machines" })).toHaveCount(0)
  return why
}

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
  // A Project added from outside shows as its machine says so (ADR 0127).
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

/** A `shot` of what shows in the light look, then dark again. */
async function lightShot({ page, dir }: Window, name: string) {
  if (!shots) return
  const look = join(dir, "config/look.toml")
  const html = page.locator("html")
  writeFileSync(look, 'mode = "light"\n')
  await expect(html).not.toHaveClass(/\bdark\b/)
  await shot(page, name)
  writeFileSync(look, 'mode = "dark"\n')
  await expect(html).toHaveClass(/\bdark\b/)
}

/** How soon Send turns on after the pill goes, in ms: the engine tries
 * again as its host is live, and its own wait is up to 5 s. */
const SOON = 1_500

/** What the pill over `pane` and its Send say at one moment, and Send
 * when back's tooltip; null where one says nothing. */
const wordsOf = (pane: Locator) =>
  pane.evaluate((own) => ({
    pill:
      own.querySelector("[data-machine-pill] [role=status]")?.textContent ??
      null,
    send:
      own.querySelector('button[aria-label="Send"]')?.getAttribute("title") ??
      null,
    later:
      [...own.querySelectorAll("button")]
        .find((button) => button.textContent === "Send when back")
        ?.getAttribute("title") ?? null,
  }))

/** Watches `pane` for `ms`: whenever its pill and its Send both say why
 * it waits, they say the same, away with when Send goes (ADR 0095,
 * decision 7), and never "Connecting" beside "away"; Send when back, as
 * it waits for the machine instead, says when it sends (ADR 0105). */
async function sameWords(pane: Locator, ms: number) {
  for (const until = Date.now() + ms; Date.now() < until;) {
    const { pill, send, later } = await wordsOf(pane)
    if (pill !== null && send !== null)
      expect(send).toBe(
        pill.endsWith(" is away") ? `${pill}. Send once it is back.` : pill
      )
    if (later !== null) {
      expect(send).toBeNull()
      expect(later).toMatch(/^Sends once \S+ is back, until .+ ↵$/)
    }
    await pane.page().waitForTimeout(100)
  }
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
  await expect(placeOf(there, "banda").first()).toBeVisible()
  await expect(there.getByText("Bench window tests")).toBeVisible()
  await stands(page, "live")
  // A Thread started there shows as it starts, with how long it works.
  send(arc, banda, "Hosts over ssh, wait")
  await expect(
    there.getByRole("option").filter({ hasText: "Hosts over ssh, wait" })
  ).toContainText(SHORT_TIME)
  await shot(page, "pr2-1-projects-live")
  // Its label's card has its longer facts: what it is, why it is awake,
  // with its Agent at work there, its build and its address; its battery
  // where it has one (ADR 0097).
  await label.hover()
  const card = cardOf(page)
  await expect(card).toContainText("live")
  await expect(card.getByRole("definition")).toContainText([
    "While 1 Agent works there",
    "same as here",
    "arc",
  ])
  const terms = card.getByRole("term")
  if (batteryHere()) {
    await expect(terms).toContainText(["Battery", "Awake", "Build", "Address"])
    await expect(
      card.getByRole("definition").filter({ hasText: "%" })
    ).toHaveText(BATTERY)
  } else {
    await expect(terms).toContainText(["Awake", "Build", "Address"])
    await expect(terms.filter({ hasText: "Battery" })).toHaveCount(0)
  }
  const box = await label.boundingBox()
  if (box) await shot(page, "machine-card", { x: box.x + 12, y: box.y + 8 })
  await page.mouse.move(900, 700)
  await expect(card).toHaveCount(0)
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
  await bandaMenu(page)
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
  const tags = sidebar.getByRole("option").locator('[data-machine-card="arc"]')
  await expect(tags).toHaveCount(2)
  const mark = sidebar
    .getByRole("option")
    .filter({ hasText: "Bench window tests" })
    .locator('[data-machine-card="arc"]')
  await expect(mark).toHaveText("arc")
  await expect(mark.locator('[data-machine-icon="server"]')).toBeVisible()
  await expect(
    sidebar
      .getByRole("option")
      .filter({ hasText: "Sidebar for arc" })
      .locator('[data-machine-card="arc"]')
  ).toHaveCount(0)
  // Its mark opens the machine's card, as its label does.
  await mark.hover()
  await expect(cardOf(page)).toContainText("Address")
  await page.mouse.move(900, 700)
  await expect(cardOf(page)).toHaveCount(0)
  await shot(page, "pr2-2-inbox-live")

  // The link drops and arc cannot be reached: away, its rows still there.
  writeFileSync(
    join(window.dir, "config/sidebar.toml"),
    'preset = "projects"\n'
  )
  await expect(there.getByText("Bench window tests")).toBeVisible()
  arc.down(true)
  arc.cut()
  await stands(page, "away")
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
  // The foot's dot says since when: when the window last heard arc.
  await expect(dotOf(page)).toHaveAttribute("title", AWAY)
  await shot(page, "pr2-3-away")
  arc.down(false)
  await stands(page, "live", 60_000)
  await expect(there.getByText("Bench window tests")).toBeVisible()

  // Stopped there from its label's ⋯: an Agent works there, so a toast
  // asks first, and Stop anyway stops it too. Stopped, it says so, as of
  // when it was last heard, its rows stay as they were, dim (#989), and
  // Start brings it back. arc's engine started again as the
  // link came back, so its Agent is given a turn that waits.
  send(arc, banda, "Hold arc, wait")
  await expect(
    there.getByRole("option").filter({ hasText: "Hold arc, wait" })
  ).toContainText(SHORT_TIME)
  await more.focus()
  await page.keyboard.press("Enter")
  await page.getByRole("menuitem", { name: "Stop Banda on arc" }).click()
  const asks = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
    .filter({ hasText: "Agents work on arc" })
  await expect(asks).toBeVisible()
  await stands(page, "live")
  if (shots) {
    // The toasts spread under the pointer, once the menu has gone.
    await expect(page.getByRole("menu")).toHaveCount(0)
    await asks.hover({ force: true })
    await page.waitForTimeout(1_000)
    await page.screenshot({ path: join(shots, "stop-asks.png") })
  }
  await asks.getByRole("button", { name: "Stop anyway" }).click()
  await expect(dotOf(page)).toHaveAttribute("title", STOPPED)
  // Stopped, its ⋯ has no Stop; its rows are still there to fold.
  await more.focus()
  await page.keyboard.press("Enter")
  await expect(
    page.getByRole("menuitem", { name: "Machine settings" })
  ).toBeVisible()
  await expect(
    page.getByRole("menuitem", { name: "Stop Banda on arc" })
  ).toHaveCount(0)
  await expect(page.getByRole("menuitem", { name: "Fold arc" })).toBeVisible()
  await page.keyboard.press("Escape")
  // Closed, the menu gives ⋯ the focus back; the picture has none.
  await expect(page.getByRole("menu")).toHaveCount(0)
  await more.blur()
  await expect(dimmed(there).getByText("Bench window tests")).toBeVisible()
  await expect(dimmed(there).getByText("Hold arc, wait")).toBeVisible()
  await shot(page, "pr2-4-stopped")
  await there.getByRole("button", { name: "Start" }).click()
  await stands(page, "live", 60_000)
  // What arc lists anew lands as the pointer leaves: the list holds under
  // it (ADR 0098 decision 6, S5c).
  await leaveSidebar(page)
  await expect(there.getByText("Bench window tests")).toBeVisible()
  await expect(dimmed(there)).toHaveCount(0)

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

test("another machine's Thread opens from the sidebar on its engine, waits while arc is away and catches up; Files opens on arc too", async () => {
  test.setTimeout(shots ? 300_000 : 120_000)
  arc = newArc()
  const banda = await seed(arc)
  window = await withArc(arc)
  const { page } = window
  const local = await work(window)
  // The page's clock, moved on by hand later, is installed as the page
  // loads. Installed into a page that runs, it reads from 0 a moment
  // before it is set, and what arc's engine says in that moment would be
  // heard in 1970.
  await page.clock.install()
  await page.reload()
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
  // and its Thread stays as it was. Send reads "Send when back": Enter
  // leaves the message at the end of the Thread, to wait for arc (ADR
  // 0105). As arc is back, it reads it again, and the message goes there,
  // once. The page's clock moves on by hand from here.
  arc.down(true)
  arc.cut()
  const away = page.getByRole("status").filter({ hasText: "arc is away" })
  await expect(away).toBeVisible()
  await expect(thread.getByText("You said: hi")).toBeVisible()
  // Its pill has arc's icon, and says for how long, by the Window's one
  // clock: nothing under a minute, then minutes, after what is said as it
  // changes. The foot's dot says it too, as arc's cards do.
  const pill = page.locator("[data-machine-pill]").filter({ has: away })
  await expect(pill.locator('[data-machine-icon="server"]')).toBeVisible()
  await expect(pill).toHaveText("arc is away")
  await expect(dotOf(page)).toHaveAttribute("title", AWAY)
  await page.clock.fastForward("02:00")
  await expect(pill).toHaveText("arc is away · 2 min")
  await expect(away).toHaveText("arc is away")
  await expect(dotOf(page)).toHaveAttribute("title", "arc · away 2m")
  await composer.fill("back again")
  const later = thread.getByRole("button", { name: "Send when back" })
  await expect(later).toBeEnabled()
  await expect(later).toHaveAttribute(
    "title",
    /^Sends once arc is back, until /
  )
  await composer.press("Enter")
  await expect(composer).toHaveText("")
  const waits = thread.getByRole("list", { name: "Waiting for arc" })
  await expect(waits).toContainText("back again")
  await expect(pill).toHaveText("arc is away · 2 min · 1 waiting")
  await shot(page, "pr3-2-away")
  arc.down(false)
  await expect(away).toHaveCount(0, { timeout: 60_000 })
  // Its engine tries again as arc is live, not on its own wait: the
  // message goes as the pill goes, and Send is itself again.
  await expect(thread.getByText("You said: back again")).toBeVisible({
    timeout: 10_000,
  })
  await expect(waits).toHaveCount(0)
  const sending = thread.getByRole("button", { name: "Send", exact: true })
  await expect(sending).not.toHaveAttribute("title")
  // arc's Agent answered it there, in the same Thread.
  await expect
    .poll(() => states(arc!, banda))
    .toEqual([["Bench window tests", "done"]])
  const [only] = threadsOf(arc!, banda)
  expect(keptOf(arc!, banda, only!.id)).toContain("You said: back again")
  // Once: nothing went while arc was away, and it went once.
  await expect(thread.getByText("You said: back again")).toHaveCount(1)
  // The window's arrangement keeps the Pane on arc: drawn anew, as after
  // a restart, it opens there again.
  await page.reload()
  await expect(thread.getByText("You said: back again")).toBeVisible()

  // Stopped there, its pill says so, by the name and icon arc says it
  // has, with Start: the Person's click on it starts Banda there by its
  // key in hosts.toml, and the Thread writes there again.
  const machine = join(arc.dir, "config/machine.toml")
  writeFileSync(machine, 'name = "Studio"\nicon = "tower"\n')
  const studio = sidebarOf(page).getByRole("group", {
    name: "Studio",
    exact: true,
  })
  await expect(studio.getByText("Bench window tests")).toBeVisible()
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as Paged).banda.hostStop("arc", false)
    )
  ).toBe("stopped")
  const stopped = page
    .locator("[data-machine-pill]")
    .filter({ hasText: "Banda is stopped on Studio" })
  await expect(stopped.locator('[data-machine-icon="tower"]')).toBeVisible()
  await expect(stopped).toHaveText("Banda is stopped on Studio·Start")
  await stopped.getByRole("button", { name: "Start" }).click()
  await expect(stopped).toHaveCount(0, { timeout: 60_000 })
  await expect(studio.getByText("Bench window tests")).toBeVisible()
  writeFileSync(machine, 'name = "arc"\nicon = "server"\n')
  await expect(arcOf(page).getByText("Bench window tests")).toBeVisible()
  await composer.fill("after start")
  // Send waits until arc's engine is connected again.
  await expect(sending).toBeEnabled({ timeout: 60_000 })
  await composer.press("Enter")
  await expect(thread.getByText("You said: after start")).toBeVisible()
  await thread.getByRole("textbox", { name: "Message to Fake AI" }).focus()

  // Files, by its key, opens on arc (ADR 0106, step 3b), and its header
  // names arc after its icon and title.
  await page.keyboard.press("Alt+KeyE")
  const other = page.getByRole("region", { name: "banda", exact: true })
  await expect(other.getByRole("tree")).toBeVisible()
  expect(await headerShows(other)).toContain("machine")
  await shot(page, "pr3-3-files-on-arc")

  // Alt+Z on arc's Thread puts it off on arc's engine, as its Pane is
  // there (#797): its Pane closes, and this machine's Thread stays awake.
  await thread.getByRole("textbox", { name: "Message to Fake AI" }).focus()
  await page.keyboard.press("Alt+KeyZ")
  const picker = page.getByRole("dialog").filter({ hasText: "Later ·" })
  await expect(picker).toContainText("Bench window tests")
  const field = picker.getByRole("textbox", { name: "When it comes back" })
  await expect(field).toBeFocused()
  await field.fill("2h")
  await field.press("Enter")
  await expect(thread).toBeHidden()
  await expect
    .poll(() => threadsOf(arc!, banda)[0]?.later?.until ?? 0)
    .toBeGreaterThan(Date.now())
  const { ok } = JSON.parse(
    window.banda("call", "agents.threads", "--project", local)
  ) as { ok: { threads: { title: string; later?: object }[] } }
  expect(ok.threads.map(({ title, later }) => [title, later])).toEqual([
    ["Sidebar for arc", undefined],
  ])
})

test("another machine's Thread says on Send what its pill says from the window's start; with arc asleep, then refused, Send waits for it; Send turns on as arc is back", async () => {
  test.setTimeout(180_000)
  arc = newArc()
  await seed(arc)
  window = await withArc(arc)
  await arcOf(window.page).getByText("Bench window tests").click()
  const threadIn = (page: Page) =>
    page.getByRole("region", { name: "Bench window tests", exact: true })
  await expect(
    threadIn(window.page).getByText("You said: Bench window tests")
  ).toBeVisible()

  // arc asleep as the window starts again on what it left: its Thread
  // says so in the pill, and Send says the same from the first moment it
  // says why, then waits for arc, as Send when back (ADR 0105).
  const { dir } = window
  await window.app.close()
  arc.down(true)
  window = await withArc(arc, program, dir)
  const { page } = window
  const thread = threadIn(page)
  const pill = thread.locator("[data-machine-pill] [role=status]")
  const sending = thread.getByRole("button", { name: "Send", exact: true })
  const later = thread.getByRole("button", { name: "Send when back" })
  await expect(pill).toHaveText("arc is away", { timeout: 30_000 })
  await expect(later).toBeVisible()
  await sameWords(thread, 4_000)
  await expect(later).toHaveAttribute(
    "title",
    /^Sends once arc is back, until /
  )
  await shot(page, "h5a-1-asleep")

  // A message sent now waits at the Thread's end, though the window has
  // not read the Thread from arc yet (ADR 0105, Q3); Cancel puts it back.
  const composer = thread.getByRole("textbox", { name: /^Message to / })
  await composer.fill("and run them again")
  await composer.press("Enter")
  await expect(composer).toHaveText("")
  const waits = thread.getByRole("list", { name: "Waiting for arc" })
  await expect(waits).toContainText("and run them again")
  await expect(waits).toContainText(/Waits for arc · until \S+/)
  await expect(pill).toHaveText("arc is away")
  await expect(thread.locator("[data-machine-pill]")).toContainText("1 waiting")
  await shot(page, "h5e-6")
  await waits.getByRole("button", { name: "Cancel" }).click()
  await expect(waits).toHaveCount(0)
  await expect(composer).toHaveText("and run them again")

  // Back, but with no banda where hosts.toml says: refused, the pill says
  // why, and Send still waits for arc.
  const hostsToml = join(dir, "config/hosts.toml")
  writeFileSync(
    hostsToml,
    '[[hosts]]\nname = "arc"\nssh = "arc"\nbanda = "/nowhere/banda"\n'
  )
  arc.down(false)
  const refused = "arc: no /nowhere/banda there; check banda in hosts.toml"
  await expect(pill).toHaveText(refused, { timeout: 30_000 })
  await sameWords(thread, 2_000)
  await expect(later).toHaveAttribute(
    "title",
    /^Sends once arc is back, until /
  )
  // Its Harness's name is not known here yet: the box goes by it later.
  await composer.fill("back on arc")
  await expect(later).toBeEnabled()

  // Its banda right again, arc is live: Send turns on as the pill goes.
  writeFileSync(
    hostsToml,
    `[[hosts]]\nname = "arc"\nssh = "arc"\nbanda = ${JSON.stringify(program)}\n`
  )
  await expect(pill).toHaveCount(0, { timeout: 60_000 })
  await expect(sending).toBeEnabled({ timeout: SOON })
  await expect(sending).not.toHaveAttribute("title")
  await composer.press("Enter")
  await expect(thread.getByText("You said: back on arc")).toBeVisible()
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
    .getByRole("option")
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
  // Alt+S archives it there, and its Pane closes at once (#974).
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

test("a new Thread's Project picker groups the Projects by machine; one started in arc's Project starts on arc's engine, arc's No Project too, and away arc stays to pick; this machine's No Project, picked on arc, never names arc and starts its Thread here", async () => {
  test.setTimeout(shots ? 300_000 : 180_000)
  arc = newArc()
  const banda = await seed(arc)
  window = await withArc(arc)
  const { page } = window
  const local = await work(window)
  // What the page asks of the workspaces: every engine it reaches, arc's
  // too, is a socket of the page's, and from this reload on each goes
  // through here.
  const asked: {
    method?: string
    params?: {
      project?: string
      pane?: string
      args?: { host?: unknown; scratchCommand?: unknown }
    }
  }[] = []
  await page.routeWebSocket(/.*/, (socket) => {
    const engine = socket.connectToServer()
    socket.onMessage((message) => {
      engine.send(message)
      const frame = JSON.parse(String(message)) as (typeof asked)[number]
      if (
        frame.method === "workspaces.open" ||
        frame.method === "workspaces.update"
      )
        asked.push(frame)
    })
  })
  await page.reload()
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
  const newInWork = () => newThreadIn(page, "Work")
  await newInWork()
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
  // Its phrase names the account; the Project's button names arc.
  await expect(
    draft.getByRole("button", { name: "Account: Fake AI" })
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
    arcOf(page).getByRole("option").filter({ hasText: "Started on arc" })
  ).toBeVisible()

  // arc's No Project: its first message makes its folder there.
  await newInWork()
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
  // A machine's Projects, and its scratch ones: arc's, or the window's own.
  const projectsOf = (on: Pick<Arc, "banda">) =>
    (
      JSON.parse(on.banda("call", "projects.list")) as {
        ok: { id: string; scratch: boolean }[]
      }
    ).ok
  const scratchOf = (on: Pick<Arc, "banda">) =>
    projectsOf(on).filter((one) => one.scratch)
  const made = () => scratchOf(arc!)
  await expect.poll(() => made().length).toBe(1)
  await expect
    .poll(() => states(arc!, made()[0]!.id))
    .toEqual([["Scratch on arc", "done"]])

  // arc goes away with the picker open: its part stays, marked away,
  // still one to pick, as Send waits there.
  await newInWork()
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
  await stands(page, "live", 60_000)

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
  // This machine's No Project, picked there, is this machine's again: what
  // an arc Pane opens in a Project of this machine's is placed once, by the
  // hosts' rule (#1004), so what the page asks of the workspaces from the
  // pick on never names arc. That is the check that fails without the rule;
  // the Pane is handed only the args of the host it is on, so arc does not
  // reach the screen even then. That is watched too: each tile drawn anew
  // from the pick on, for its machine's icon, or "on arc" in its words or
  // its composer's placeholder, as it shows and as a draw since took it out
  // or changed it, as an observer hears two draws in one task only after
  // both.
  asked.length = 0
  const problems = {
    here: window.banda("problems"),
    arc: arc.banda("problems"),
  }
  expect(scratchOf(window)).toEqual([])
  await page.evaluate(() => {
    const tiles = () =>
      document.querySelectorAll<HTMLElement>("section[data-tile]")
    const before = new Set([...tiles()].map((tile) => tile.dataset.tile))
    const drawn = { tiles: [] as string[], onArc: [] as string[] }
    ;(globalThis as { drawn?: typeof drawn }).drawn = drawn
    const ON_ARC = /\S* on arc\b/
    const arcIn = (node: Node) =>
      node instanceof Element &&
      (node.matches("[data-machine-icon]") ||
        node.querySelector("[data-machine-icon]"))
        ? "arc's icon"
        : ON_ARC.exec(node.textContent ?? "")?.[0]
    const say = (tile: HTMLElement, said: string | undefined) => {
      const seen = `${tile.getAttribute("aria-label")}: ${said}`
      if (said && !drawn.onArc.includes(seen)) drawn.onArc.push(seen)
    }
    const anew = (node: Node | null) => {
      const at = node instanceof Element ? node : node?.parentElement
      const tile = at?.closest<HTMLElement>("section[data-tile]")
      return tile && !before.has(tile.dataset.tile) ? tile : undefined
    }
    new MutationObserver((records) => {
      for (const tile of tiles()) {
        if (!anew(tile)) continue
        if (!drawn.tiles.includes(tile.dataset.tile!))
          drawn.tiles.push(tile.dataset.tile!)
        say(tile, arcIn(tile))
        for (const one of tile.querySelectorAll("[aria-placeholder]"))
          say(tile, ON_ARC.exec(one.getAttribute("aria-placeholder")!)?.[0])
      }
      for (const record of records) {
        const tile = anew(record.target)
        if (!tile) continue
        for (const node of record.removedNodes) say(tile, arcIn(node))
        say(tile, ON_ARC.exec(record.oldValue ?? "")?.[0])
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeOldValue: true,
      characterDataOldValue: true,
    })
  })
  await menu
    .getByRole("menuitemradio", { name: /^No Project/ })
    .first()
    .click()
  await expect(
    draft.getByRole("button", { name: "Project: No Project", exact: true })
  ).toBeVisible()
  expect(await headerShows(draft)).not.toContain("machine")
  const here = draft.getByRole("textbox", { name: "Message to Fake AI" })
  await expect(here).toHaveAttribute("aria-placeholder", /^Write to Fake AI\. /)
  // Sent, its first message makes this machine's scratch folder, and its
  // Thread runs on this machine's Agent; arc makes none.
  await here.fill("Started here")
  await here.press("Enter")
  await expect(
    page
      .getByRole("region", { name: "Started here", exact: true })
      .getByText("You said: Started here")
  ).toBeVisible()
  await expect.poll(() => scratchOf(window!).length).toBe(1)
  await expect
    .poll(() => states(window!, scratchOf(window!)[0]!.id))
    .toEqual([["Started here", "done"]])
  expect(made()).toHaveLength(1)
  const drawn = (await page.evaluate("globalThis.drawn")) as {
    tiles: string[]
    onArc: string[]
  }
  // What the page asked of the workspaces since the pick, the move's Pane
  // first, named no host: no open outside arc's Projects, and no update of
  // a tile drawn since, the scratch command's among them. arc's own Panes,
  // still open, may update theirs, rightly on arc.
  const arcs = new Set(projectsOf(arc).map((one) => one.id))
  const placed = asked.filter((one) =>
    one.method === "workspaces.open"
      ? !arcs.has(one.params?.project ?? "")
      : drawn.tiles.includes(one.params?.pane ?? "")
  )
  expect(placed.map((one) => one.method)).toContain("workspaces.open")
  expect(
    placed.some(
      (one) =>
        one.method === "workspaces.update" &&
        one.params?.args?.scratchCommand !== undefined
    )
  ).toBe(true)
  expect(placed.filter((one) => one.params?.args?.host !== undefined)).toEqual(
    []
  )
  expect(drawn.tiles.length).toBeGreaterThan(0)
  expect(drawn.onArc).toEqual([])
  // Nor did any read for this machine's Project go to arc and fail there.
  expect(window.banda("problems")).toBe(problems.here)
  expect(arc.banda("problems")).toBe(problems.arc)
})

test("a popped-out Pane on arc picks from the window's machines: this machine's Projects first, then arc's under its name", async () => {
  test.setTimeout(shots ? 300_000 : 120_000)
  arc = newArc()
  await seed(arc)
  window = await withArc(arc)
  const { page, app } = window
  await work(window)
  await expect(arcOf(page).getByText("Bench window tests")).toBeVisible()
  await page
    .getByRole("region", { name: "New Thread" })
    .getByRole("button", { name: "Close New Thread", exact: true })
    .click()
  // A new Thread in arc's banda, picked in the window.
  await newThreadIn(page, "Work")
  const draft = page
    .getByRole("region", { name: "New Thread" })
    .and(page.locator('[data-focused="true"]'))
  await draft.getByRole("button", { name: "Project: Work" }).click()
  await page
    .getByRole("menu")
    .getByRole("group", { name: /^arc/ })
    .getByRole("menuitemradio", { name: /^banda/ })
    .click()
  await expect(
    draft.getByRole("button", { name: "Project: banda on arc" })
  ).toBeVisible()

  // In a window of its own, its picker lists what the window's does.
  await draft.getByRole("button", { name: "Pane menu" }).click()
  const [popped] = await Promise.all([
    app.waitForEvent("window"),
    page.getByRole("menuitem", { name: "In its own window" }).click(),
  ])
  await popped.waitForLoadState()
  await popped.getByRole("button", { name: "Project: banda on arc" }).click()
  const menu = popped.getByRole("menu")
  await expect(menu.getByRole("menuitemradio")).toHaveText([
    /No Project/,
    /Work/,
    /No Project/,
    /banda/,
  ])
  const arcPart = menu.getByRole("group", { name: /^arc/ })
  await expect(arcPart.getByRole("menuitemradio")).toHaveText([
    /No Project/,
    /banda/,
  ])
  await expect(arcPart.locator('[data-machine-icon="server"]')).toBeVisible()
  await expect(
    arcPart.getByRole("menuitemradio", { name: /^banda/ })
  ).toHaveAttribute("aria-checked", "true")
  await expect(menu.getByRole("menuitem", { name: "Add Project" })).toHaveCount(
    0
  )
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
      .getByRole("option", { name: new RegExp(title) })
      .getByRole("img", { name: "Done" })
  await expect(done("Sidebar for arc")).toBeVisible()
  await expect(done("Bench window tests")).toBeVisible()

  // Alt+U goes down Your turn as the Inbox lists it, the oldest first
  // whichever machine it is on (ADR 0098, S5b): arc's Thread, seeded
  // before this one's, opens first, read live from arc's engine; then
  // this machine's.
  await page.keyboard.press("Alt+U")
  const bench = page.getByRole("region", {
    name: "Bench window tests",
    exact: true,
  })
  await expect(bench).toHaveAttribute("data-focused", "true")
  await expect(bench.getByText("You said: Bench window tests")).toBeVisible()
  await page.keyboard.press("Alt+U")
  await expect(
    page.getByRole("region", { name: "Sidebar for arc", exact: true })
  ).toHaveAttribute("data-focused", "true")

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

test("another machine's Thread that asks has its toast name arc, and Allow and Try again go to arc's engine; with arc away an Allow is refused at once, and sent nowhere", async () => {
  test.setTimeout(shots ? 300_000 : 180_000)
  arc = newArc()
  const banda = await seed(arc)
  window = await withArc(arc)
  const { page } = window
  const local = await work(window)
  await expect(sidebarOf(page).getByText("Sidebar for arc")).toBeVisible()
  // arc's list is heard first: what calls in a Project's first list
  // already was, and tells nothing.
  await expect(arcOf(page).getByText("Bench window tests")).toBeVisible()
  const toasts = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
  const threadOf = (title: string) =>
    threadsOf(arc!, banda).find((thread) => thread.title === title)
  const stateOf = (title: string) => threadOf(title)?.latest?.state
  /** How each Question arc keeps in the Thread `title` stands. */
  const questionsOf = (title: string) => {
    const states: string[] = []
    const walk = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(walk)
      if (!value || typeof value !== "object") return
      const one = value as Record<string, unknown>
      if (Array.isArray(one.choices) && typeof one.state === "string")
        states.push(one.state)
      Object.values(one).forEach(walk)
    }
    walk(JSON.parse(keptOf(arc!, banda, threadOf(title)!.id)))
    return states
  }

  // An Agent on arc asks to run something, out of sight: its toast names
  // arc after the title, with Allow and Reject, and Allow runs it there.
  send(arc, banda, "please ask first")
  const asks = toasts.filter({ hasText: "please ask first" })
  await expect(asks).toContainText("please ask first · arc")
  const allow = asks.getByRole("button", { name: "Allow", exact: true })
  await expect(allow).toBeVisible()
  await expect(asks.getByRole("button", { name: "Reject" })).toBeVisible()
  if (shots) {
    // Once the toast has come in.
    await page.waitForTimeout(1_000)
    await page.screenshot({ path: join(shots, "h5d-1-arc-asks-toast.png") })
  }
  await allow.click()
  await expect.poll(() => stateOf("please ask first")).toBe("done")
  expect(questionsOf("please ask first")).toEqual(["answered"])

  // A turn there that fails is tried again there, from its toast.
  send(arc, banda, "a flaky one")
  const failed = toasts.filter({ hasText: "a flaky one" })
  await expect(failed).toContainText("a flaky one · arc")
  await failed.getByRole("button", { name: "Try again" }).click()
  await expect.poll(() => stateOf("a flaky one")).toBe("done")

  // With arc away, its Allow is refused at once, in the pill's words,
  // and goes to no machine: not to arc later, nor to this one now.
  send(arc, banda, "ask once more")
  const again = toasts.filter({ hasText: "ask once more" })
  await expect(again).toContainText("ask once more · arc")
  arc.down(true)
  arc.cut()
  await stands(page, "away")
  await expect(again).toBeVisible()
  await again.getByRole("button", { name: "Allow", exact: true }).click()
  await expect(toasts.filter({ hasText: "arc is away" })).toBeVisible({
    timeout: 2_000,
  })
  if (shots) {
    await page.waitForTimeout(1_000)
    await page.screenshot({ path: join(shots, "h5d-2-arc-away-refused.png") })
  }
  const { ok } = JSON.parse(
    window.banda("call", "agents.threads", "--project", local)
  ) as { ok: { threads: { title: string }[] } }
  expect(ok.threads.map(({ title }) => title)).toEqual(["Sidebar for arc"])
  arc.down(false)
  await stands(page, "live", 60_000)
  // Back, and heard again, as a Thread it starts now shows in its list:
  // nothing it was refused runs there by itself, a while after either.
  send(arc, banda, "back on arc")
  await expect(arcOf(page).getByText("back on arc")).toBeVisible({
    timeout: 30_000,
  })
  for (const until = Date.now() + 5_000; Date.now() < until;) {
    expect(questionsOf("ask once more")).not.toContain("answered")
    await page.waitForTimeout(250)
  }
})

/** arc's Thread "Bench window tests", opened from the sidebar, with a
 * turn at work there that waits until it is stopped; its Pane. */
async function working(page: Page) {
  await arcOf(page).getByText("Bench window tests").click()
  const thread = page.getByRole("region", {
    name: "Bench window tests",
    exact: true,
  })
  const composer = thread.getByRole("textbox", { name: "Message to Fake AI" })
  await composer.fill("wait for it")
  await composer.press("Enter")
  await expect(thread.getByText("Waiting.")).toBeVisible()
  return thread
}

test("with arc away, Stop on its Thread is refused at once in a toast that names arc, and goes nowhere: arc back, its turn still works there", async () => {
  test.setTimeout(shots ? 300_000 : 180_000)
  arc = newArc()
  const banda = await seed(arc)
  const stopEngine = await held(arc)
  window = await withArc(arc)
  const { page } = window
  const toasts = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
  const thread = await working(page)
  const stop = thread.getByRole("button", { name: "Stop", exact: true })
  const runs = () =>
    expect(states(arc!, banda)).toEqual([["Bench window tests", "running"]])

  // The link drops: arc is away, and its engine there works on. The
  // Thread stands as it was, Stop and all; pressed, it is refused at
  // once, in a toast that names arc and Stop.
  arc.down(true)
  arc.cut()
  await stands(page, "away")
  await stop.click()
  await expect(
    toasts.filter({ hasText: "arc is away: Stop was not sent." })
  ).toBeVisible({ timeout: 2_000 })
  // Nothing in the Thread's own words, and nothing waits on it.
  await expect(thread.getByRole("alert")).toHaveCount(0)
  await expect(stop).toBeEnabled()
  if (shots) {
    await page.mouse.move(900, 700)
    await page.waitForTimeout(1_000)
    await page.screenshot({ path: join(shots, "h5b-1.png") })
  }
  runs()

  // arc back, and heard again: nothing refused went there by itself, a
  // while after either.
  arc.down(false)
  await stands(page, "live", 60_000)
  await expect(stop).toBeVisible()
  for (const until = Date.now() + 5_000; Date.now() < until;) {
    runs()
    await page.waitForTimeout(250)
  }
  // Pressed now, Stop goes.
  await stop.click()
  await expect
    .poll(() => states(arc!, banda))
    .toEqual([["Bench window tests", "stopped"]])
  await stopEngine()
})

test("a Stop on its way as arc goes says at once that it may have gone through, and the window sends it no more", async () => {
  test.setTimeout(shots ? 300_000 : 180_000)
  arc = newArc()
  const banda = await seed(arc)
  const stopEngine = await held(arc)
  // arc's answers come late, as from far away: Stop is still on its way
  // as the link drops.
  window = await withArc(arc, program, undefined, undefined, 1_500)
  const { page } = window
  const toasts = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
  const thread = await working(page)
  await thread.getByRole("button", { name: "Stop", exact: true }).click()
  arc.down(true)
  arc.cut()
  const gone = toasts.filter({
    hasText: "arc went away; Stop may have gone through.",
  })
  await expect(gone).toBeVisible({ timeout: 5_000 })
  if (shots) {
    await page.mouse.move(900, 700)
    await page.waitForTimeout(1_000)
    await page.screenshot({ path: join(shots, "h5b-2.png") })
  }
  // It reached arc before the link dropped, and stopped the turn there,
  // or it did not, and the turn works on: either way, the window sends it
  // no more once arc is back.
  await page.waitForTimeout(2_000)
  const [[, then]] = states(arc!, banda) as [[string, string]]
  expect(["stopped", "running"]).toContain(then)
  arc.down(false)
  await stands(page, "live", 60_000)
  for (const until = Date.now() + 5_000; Date.now() < until;) {
    expect(states(arc!, banda)).toEqual([["Bench window tests", then]])
    await page.waitForTimeout(250)
  }
  await stopEngine()
})

test("with arc away, the Banda menu's words for a new Thread on arc are refused at once and wait in its composer: arc back, nothing starts there by itself", async () => {
  test.setTimeout(shots ? 300_000 : 180_000)
  arc = newArc()
  const banda = await seed(arc)
  const stopEngine = await held(arc)
  window = await withArc(arc)
  const { page } = window
  const toasts = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
  // In arc's Thread, so the menu's New Thread starts in arc's Project.
  await arcOf(page).getByText("Bench window tests").click()
  await expect(
    page
      .getByRole("region", { name: "Bench window tests", exact: true })
      .getByText("You said: Bench window tests")
  ).toBeVisible()
  arc.down(true)
  arc.cut()
  await stands(page, "away")

  // Its words are refused at once, in a toast that names arc, and wait in
  // the new Thread's composer for the Person to send.
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await bandaMenu(page)
  await menu.getByRole("combobox", { name: "Search" }).fill("fix the tests")
  await menu
    .getByRole("option")
    .filter({ hasText: "New Thread: “fix the tests”" })
    .click()
  await expect(
    toasts.filter({ hasText: "arc is away: your message was not sent." })
  ).toBeVisible({ timeout: 2_000 })
  const draft = page
    .getByRole("region", { name: "New Thread" })
    .and(page.locator('[data-focused="true"]'))
  const composer = draft.getByRole("textbox", { name: /^Message to / })
  await expect(composer).toHaveText("fix the tests")
  if (shots) {
    await page.mouse.move(900, 700)
    await page.waitForTimeout(1_000)
    await page.screenshot({ path: join(shots, "h5b-4.png") })
  }

  // arc back, and heard again: no Thread starts there by itself, a while
  // after either; the words still wait.
  arc.down(false)
  await stands(page, "live", 60_000)
  for (const until = Date.now() + 5_000; Date.now() < until;) {
    expect(states(arc!, banda)).toEqual([["Bench window tests", "done"]])
    await page.waitForTimeout(250)
  }
  await expect(composer).toHaveText("fix the tests")
  await stopEngine()
})

/** `at` today as the page's clock says it by 24 hours: "14:02". */
const clockAt = (page: Page, at: number): Promise<string> =>
  page.evaluate(
    (at) =>
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(at),
    at
  )

/** Writes `text` into arc's Thread `thread` in `project` from arc itself,
 * as if from another window there. */
function writeOnArc(arc: Arc, project: string, thread: string, text: string) {
  arc.banda(
    "call",
    "agents.send",
    "--project",
    project,
    "--params",
    JSON.stringify({ thread, text, settings: null })
  )
}

test("arc that answers nothing is away in seconds: Send fails at once, the foot's machines say since when it was last heard and its rows dim with their words; what arc wrote meanwhile shows once it answers; stopped, it keeps its rows (H5c)", async () => {
  test.setTimeout(shots ? 300_000 : 180_000)
  arc = newArc()
  const banda = await seed(arc)
  const stopEngine = await held(arc)
  window = await withArc(arc)
  const { page } = window
  await work(window)
  // The page's clock is moved on by hand from here, its timers made anew.
  await page.clock.install()
  await page.reload()
  const sidebar = sidebarOf(page)
  await expect(sidebar.getByText("Sidebar for arc")).toBeVisible()
  const there = arcOf(page)
  const toasts = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
  await there.getByText("Bench window tests").click()
  const thread = page.getByRole("region", {
    name: "Bench window tests",
    exact: true,
  })
  await expect(thread.getByText("You said: Bench window tests")).toBeVisible()
  const composer = thread.getByRole("textbox", { name: "Message to Fake AI" })
  const sending = thread.getByRole("button", { name: "Send", exact: true })
  const pill = thread.locator("[data-machine-pill]")
  const words = "and run them again with 8 shards"
  await composer.fill(words)
  await expect(sending).toBeEnabled()
  const [only] = threadsOf(arc, banda)

  // arc answers nothing, its link up all the same. Send in the dead gap
  // asks arc first, as nothing was heard for 5 s, hears nothing in 3 s,
  // and says so at once, the words kept (ADR 0082, decision 11).
  const before = await page.evaluate(() => Date.now())
  arc.hush(true)
  await page.clock.fastForward("00:06")
  const pressed = Date.now()
  await composer.press("Enter")
  const refused = toasts.filter({
    hasText: "arc is away: your message was not sent.",
  })
  await expect(refused).toBeVisible({ timeout: 5_000 })
  expect(Date.now() - pressed).toBeGreaterThanOrEqual(2_500)
  await expect(composer).toHaveText(words)
  if (shots) {
    await page.mouse.move(900, 700)
    await page.waitForTimeout(500)
    await page.screenshot({ path: join(shots, "h5c-3.png") })
  }

  // arc is away (Q7): the foot's dot says so, and its row in the foot's
  // machines why, since when the window last heard it (ADR 0098,
  // decision 18); its rows dim, each with its own words; this machine's
  // do not. The pill says it as when its link is gone, and Send waits for
  // arc (ADR 0105).
  await expect(dotOf(page)).toHaveAttribute("title", AWAY)
  const why = await machineWhy(page)
  const heard = why.replace("arc has not answered since ", "")
  expect([
    await clockAt(page, before - 16_000),
    await clockAt(page, before),
  ]).toContain(heard)
  await expect(dimmed(there).getByText("Bench window tests")).toBeVisible()
  await expect(dimmed(sidebar).getByText("Sidebar for arc")).toHaveCount(0)
  await expect(pill).toHaveText("arc is away")
  await expect(pill.locator('[data-machine-icon="server"]')).toBeVisible()
  const later = thread.getByRole("button", { name: "Send when back" })
  await expect(later).toBeEnabled()
  await expect(later).toHaveAttribute(
    "title",
    /^Sends once arc is back, until /
  )
  // What arc writes meanwhile, the window does not hear yet (#801).
  writeOnArc(arc, banda, only!.id, "written while quiet")
  await expect
    .poll(() => keptOf(arc!, banda, only!.id))
    .toContain("You said: written while quiet")
  await expect(thread.getByText("You said: written while quiet")).toHaveCount(0)
  // A while on, the pill and the dot say for how long; why stays.
  await page.clock.fastForward("02:00")
  await expect(pill).toHaveText("arc is away · 2 min")
  await expect(dotOf(page)).toHaveAttribute("title", "arc · away 2m")
  expect(await machineWhy(page)).toBe(why)
  await shot(page, "h5c-1")
  await lightShot(window, "h5c-1-light")

  // arc answers again: its dot is live, its rows undim, the pill goes
  // and Send is on, the words still there; what it wrote meanwhile shows.
  arc.hush(false)
  await stands(page, "live", 10_000)
  await expect(dimmed(there)).toHaveCount(0)
  await expect(pill).toHaveCount(0)
  await expect(sending).toBeEnabled({ timeout: SOON })
  await expect(composer).toHaveText(words)
  await expect(thread.getByText("You said: written while quiet")).toBeVisible()
  await shot(page, "h5c-4")

  // Left alone, two pings with nothing heard after them make it away too.
  // What was on its way as the link went still may land between pings, so
  // the clock moves a ping on at a time until it shows.
  arc.hush(true)
  await expect(async () => {
    await page.clock.fastForward("00:16")
    await stands(page, "away", 500)
  }).toPass({ timeout: 15_000 })
  await expect(dimmed(there).getByText("Bench window tests")).toBeVisible()
  arc.hush(false)
  await stands(page, "live", 10_000)

  // The link drops, and arc's engine runs on and writes there: back, the
  // Pane shows it (#801).
  arc.down(true)
  arc.cut()
  await stands(page, "away")
  writeOnArc(arc, banda, only!.id, "written while cut")
  await expect
    .poll(() => keptOf(arc!, banda, only!.id))
    .toContain("You said: written while cut")
  arc.down(false)
  await stands(page, "live", 60_000)
  await expect(thread.getByText("You said: written while cut")).toBeVisible()

  // Banda stopped there: its rows stay, dim, with their words (Q8), its
  // dot says stopped, and its label has Start; the pill says why, and
  // Send waits for arc.
  await expect(sending).toBeEnabled({ timeout: 60_000 })
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as Paged).banda.hostStop("arc", false)
    )
  ).toBe("stopped")
  await expect(dotOf(page)).toHaveAttribute("title", STOPPED)
  await expect(dimmed(there).getByText("Bench window tests")).toBeVisible()
  await expect(pill).toHaveText("Banda is stopped on arc·Start")
  await expect(later).toHaveAttribute(
    "title",
    /^Sends once arc is back, until /
  )
  await shot(page, "h5c-2")
  await lightShot(window, "h5c-2-light")
  // Its ⋯, shown as the pointer is over its label or as Tab reaches it
  // (headless, nothing hovers), sits beside Start, never over it.
  const starting = there.getByRole("button", { name: "Start" })
  const more = there.getByRole("button", { name: "arc menu" })
  await starting.focus()
  await page.keyboard.press("Tab")
  await expect(more).toBeFocused()
  const box = async (part: Locator) => (await part.boundingBox())!
  const start = await box(starting)
  const dots = await box(more)
  expect(dots.width).toBeGreaterThan(10)
  const group = await box(there)
  // Start's edge meets the ⋯, as it always did, but no more, to the
  // rounding of a pixel.
  expect(start.x + start.width).toBeCloseTo(dots.x, 0)
  expect(dots.x + dots.width).toBeLessThanOrEqual(group.x + group.width + 1)
  // The ⋯ took its place at once: a moment on, longer than a button's
  // colours take to ease, Start has not slid along under it.
  await page.waitForTimeout(300)
  expect(await box(starting)).toEqual(start)
  expect(await box(more)).toEqual(dots)
  if (shots) {
    await page.waitForTimeout(500)
    await page.screenshot({ path: join(shots, "h5c-5.png") })
  }
  await more.blur()
  await starting.click()
  await stands(page, "live", 60_000)
  await expect(dimmed(there)).toHaveCount(0, { timeout: 60_000 })
  await expect(pill).toHaveCount(0)
  await stopEngine()
})

/** How many times the Person's message `text` reached arc's Thread
 * `thread` in `project`. */
function sentOf(arc: Arc, project: string, thread: string, text: string) {
  const { ok } = JSON.parse(keptOf(arc, project, thread)) as {
    ok: { items: { author: { kind: string }; body: { text?: string } }[] }
  }
  return ok.items.filter(
    ({ author, body }) => author.kind === "person" && body.text === text
  ).length
}

/** What the window keeps as Thread `thread`'s draft (drafts.ts). */
const draftOf = (page: Page, thread: string) =>
  page.evaluate(
    (thread) => localStorage.getItem(`banda.agents.draft.${thread}`),
    thread
  )

test("with arc away, a message to its Thread waits as Send when back, shown at its end and counted in the pill; past its time it is not sent and comes back into the draft; arc back, the next goes once (H5e)", async () => {
  test.setTimeout(shots ? 300_000 : 180_000)
  arc = newArc()
  const banda = await seed(arc)
  // arc's engine runs on as the link goes, so its Agent answers once the
  // window reaches it again.
  const stopEngine = await held(arc)
  window = await withArc(arc)
  const { page } = window
  await work(window)
  // The page's clock starts at 14:30 today and is moved on by hand from
  // there, its timers made anew: arc's engine keeps its own.
  const today = new Date()
  const at = (hours: number, minutes: number) =>
    new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      hours,
      minutes
    ).getTime()
  await page.clock.install({ time: at(14, 30) })
  await page.reload()
  await expect(sidebarOf(page).getByText("Sidebar for arc")).toBeVisible()
  await arcOf(page).getByText("Bench window tests").click()
  const thread = page.getByRole("region", {
    name: "Bench window tests",
    exact: true,
  })
  await expect(thread.getByText("You said: Bench window tests")).toBeVisible()
  const [only] = threadsOf(arc, banda)
  const composer = thread.getByRole("textbox", { name: "Message to Fake AI" })
  const pill = thread.locator("[data-machine-pill]")
  const toasts = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
  // A ping says how far arc's clock is from the page's, which the time
  // a message waits for goes to arc in.
  await page.clock.fastForward("00:16")
  await page.waitForTimeout(1_000)

  // arc goes. In its started Thread, Send itself reads "Send when back",
  // with when it gives up, 10 minutes from now (Q2).
  arc.down(true)
  arc.cut()
  await expect(pill).toHaveText("arc is away", { timeout: 30_000 })
  await page.clock.fastForward("02:00")
  await expect(pill).toHaveText("arc is away · 2 min")
  const words = "and run them again with 8 shards"
  await composer.fill(words)
  const later = thread.getByRole("button", { name: "Send when back" })
  const at1442 = await clockAt(page, at(14, 42))
  await expect(later).toBeEnabled()
  await expect(later).toHaveAttribute(
    "title",
    `Sends once arc is back, until ${at1442} ↵`
  )
  await expect(
    thread.getByRole("button", { name: "Send", exact: true })
  ).toHaveCount(0)
  const button = (await later.boundingBox())!
  await shot(page, "h5e-1", {
    x: button.x + button.width / 2,
    y: button.y + button.height / 2,
  })

  // Enter does the same: the message waits at the end of the Thread, dim,
  // with when it gives up, Edit and Cancel; the pill counts it (Q3).
  await composer.press("Enter")
  await expect(composer).toHaveText("")
  const waits = thread.getByRole("list", { name: "Waiting for arc" })
  await expect(waits.getByRole("listitem")).toHaveCount(1)
  await expect(waits).toContainText(words)
  await expect(waits).toContainText(`Waits for arc · until ${at1442}`)
  await expect(waits.getByRole("button", { name: "Edit" })).toBeVisible()
  await expect(waits.getByRole("button", { name: "Cancel" })).toBeVisible()
  await expect(pill).toHaveText("arc is away · 2 min · 1 waiting")
  // With nothing written it is quiet, as Send is.
  await expect(later).toBeDisabled()
  await shot(page, "h5e-2")

  // "until 14:42" opens Keep for, the default checked (Q4); a right click
  // on the message opens it too. Each counts from when Send was pressed.
  const until = waits.getByRole("button", { name: `until ${at1442}` })
  await until.click()
  const menu = page.getByRole("menu")
  await expect(menu).toContainText("Keep for")
  await expect(
    menu.getByRole("menuitemradio", { name: /^10 min/ })
  ).toHaveAttribute("aria-checked", "true")
  await expect(menu.getByRole("menuitemradio")).toHaveText([
    /^10 min\s*default$/,
    "1 hour",
    "1 day",
    "7 days",
  ])
  const hour = menu.getByRole("menuitemradio", { name: "1 hour" })
  const item = (await hour.boundingBox())!
  await shot(page, "h5e-3", {
    x: item.x + item.width / 2,
    y: item.y + item.height / 2,
  })
  await page.keyboard.press("Escape")
  await expect(menu).toHaveCount(0)
  await waits.getByText(words).click({ button: "right" })
  await menu.getByRole("menuitemradio", { name: "1 hour" }).click()
  await expect(waits).toContainText(
    `Waits for arc · until ${await clockAt(page, at(15, 32))}`
  )
  await waits.getByRole("button", { name: /^until / }).click()
  await menu.getByRole("menuitemradio", { name: /^10 min/ }).click()
  await expect(waits).toContainText(`Waits for arc · until ${at1442}`)

  // Edit opens it in place, and it keeps its time.
  await waits.getByRole("button", { name: "Edit" }).click()
  const editing = thread.getByRole("textbox", { name: "Waiting message" })
  await expect(editing).toHaveValue(words)
  await editing.fill("and run them again with 4 shards")
  await editing.press("Enter")
  await expect(waits).toContainText("and run them again with 4 shards")
  await expect(waits).toContainText(`Waits for arc · until ${at1442}`)
  await waits.getByRole("button", { name: "Edit" }).click()
  await editing.fill(words)
  await editing.press("Enter")
  await expect(waits).toContainText(words)

  // At 14:42 arc is still away: the message is not sent. Its words are
  // back in the draft, and a toast says so, with no Open, as its Thread is
  // on screen (Q5); the pill counts none.
  await page.clock.fastForward("10:00")
  const notSent = toasts.filter({
    hasText: `Not sent: arc was still away at ${at1442}.`,
  })
  await expect(notSent).toBeVisible()
  await expect(notSent.getByRole("button", { name: "Open" })).toHaveCount(0)
  await expect(waits).toHaveCount(0)
  await expect(composer).toHaveText(words)
  await expect(pill).toHaveText("arc is away · 12 min")
  await expect(later).toBeEnabled()
  if (shots) {
    await page.mouse.move(900, 700)
    await page.waitForTimeout(500)
    await page.screenshot({ path: join(shots, "h5e-5.png") })
  }

  // Cancel takes one back into the draft too, above anything new there,
  // after a blank line.
  await composer.press("Enter")
  await expect(waits).toContainText(words)
  await composer.fill("and the slow ones first")
  await waits.getByRole("button", { name: "Cancel" }).click()
  await expect(waits).toHaveCount(0)
  await expect
    .poll(() => draftOf(page, only!.id))
    .toBe(`${words}\n\nand the slow ones first`)
  await composer.fill(words)
  await composer.press("Enter")
  await expect(waits).toContainText(words)
  await expect(pill).toHaveText("arc is away · 12 min · 1 waiting")

  // arc back: the message goes once, by the ID it was queued with, and
  // nothing says so; Send is itself again. The one past its time never
  // went: arc's Agent heard it once.
  arc.down(false)
  await expect(pill).toHaveCount(0, { timeout: 60_000 })
  const sent = thread.getByText(words, { exact: true })
  await expect(sent).toBeVisible({ timeout: 10_000 })
  await expect(waits).toHaveCount(0)
  await expect(
    thread.getByRole("button", { name: "Send", exact: true })
  ).toBeVisible()
  await expect(toasts).toHaveCount(0)
  // Its Person's message went once: arc's Agent heard it once.
  await expect.poll(() => sentOf(arc!, banda, only!.id, words)).toBe(1)
  expect(keptOf(arc, banda, only!.id)).not.toContain("and the slow ones first")
  // arc's Agent ran them once, and said so once.
  const answered = thread.getByText("The tests passed.")
  await expect(answered).toBeVisible()
  await page.waitForTimeout(1_000)
  await expect(sent).toHaveCount(1)
  await expect(answered).toHaveCount(1)
  await shot(page, "h5e-4")
  await stopEngine()
})

/** arc's Thread "Bench window tests" in `page`. */
const benchIn = (page: Page) =>
  page.getByRole("region", { name: "Bench window tests", exact: true })

/** The window quit and started again on what it left, its storage
 * too: a start that went well, as the test says, however soon it ends
 * (ADR 0039). */
async function again(was: Window, arc: Arc): Promise<Window> {
  await was.page.evaluate(() => localStorage.removeItem("banda.starts"))
  await was.app.close()
  return withArc(arc, program, was.dir)
}

/** Opens arc's Thread "Bench window tests", lets arc go, and queues
 * `words` there; what its row says of when it gives up: "until 14:42". */
async function waitingOn(page: Page, words: string): Promise<string> {
  await arcOf(page).getByText("Bench window tests").click()
  const thread = benchIn(page)
  await expect(thread.getByText("You said: Bench window tests")).toBeVisible()
  arc!.down(true)
  arc!.cut()
  await expect(thread.locator("[data-machine-pill]")).toContainText(
    "arc is away",
    { timeout: 30_000 }
  )
  const composer = thread.getByRole("textbox", { name: "Message to Fake AI" })
  await composer.fill(words)
  await composer.press("Enter")
  const waits = thread.getByRole("list", { name: "Waiting for arc" })
  await expect(waits).toContainText(words)
  return (await waits.getByRole("button", { name: /^until / }).textContent())!
}

test("what waits for arc is this device's: the window started again with arc away, it still waits, its Pane showing what the message kept of its Thread; arc back, it goes once (H5e-2)", async () => {
  test.setTimeout(shots ? 300_000 : 180_000)
  arc = newArc()
  const banda = await seed(arc)
  const stopEngine = await held(arc)
  window = await withArc(arc)
  const words = "and run them again with 8 shards"
  const until = await waitingOn(window.page, words)
  const [only] = threadsOf(arc, banda)

  // The window starts again on what it left, arc still away, and its
  // clock is moved on by hand: the message is still there, as it was.
  window = await again(window, arc)
  const { page } = window
  await page.clock.install()
  await page.reload()
  const thread = benchIn(page)
  const waits = thread.getByRole("list", { name: "Waiting for arc" })
  await expect(waits.getByRole("listitem")).toHaveCount(1)
  await expect(waits).toContainText(words)
  await expect(waits).toContainText(`Waits for arc · ${until}`)
  await expect(waits.getByRole("button", { name: "Edit" })).toBeVisible()
  await expect(waits.getByRole("button", { name: "Cancel" })).toBeVisible()
  // Nothing above it: the window has not read the Thread from arc.
  await expect(thread.getByText("You said: Bench window tests")).toHaveCount(0)
  // Its header and its composer, from what the message kept: its
  // Project, arc, its title, and its Harness's name; no Mark, as the
  // window does not know how the Thread stands, nor model nor mode.
  await expect(thread.locator("header").first()).toContainText("banda", {
    timeout: 10_000,
  })
  expect(await headerShows(thread)).toEqual([
    "project",
    "machine",
    "Bench window tests",
    "buttons",
  ])
  const composer = thread.getByRole("textbox", { name: "Message to Fake AI" })
  await expect(composer).toHaveAttribute(
    "aria-placeholder",
    "Write to Fake AI on arc. @ files, / commands, $ skills"
  )
  await expect(thread.getByRole("button", { name: /^Model: / })).toHaveCount(0)
  await expect(thread.getByRole("button", { name: /^Mode: / })).toHaveCount(0)
  // The pill counts it, and says no minutes, as the window does not know
  // since when arc is away.
  const pill = thread.locator("[data-machine-pill]")
  await expect(pill).toHaveText("arc is away · 1 waiting", { timeout: 30_000 })
  await page.clock.fastForward("03:00")
  await expect(pill).toHaveText("arc is away · 1 waiting")
  await expect(waits).toContainText(`Waits for arc · ${until}`)
  await shot(page, "h5e-7")

  // arc back: it goes once, by the ID it was queued with, and arc's
  // Agent answers once.
  arc.down(false)
  await expect(pill).toHaveCount(0, { timeout: 60_000 })
  await expect(waits).toHaveCount(0, { timeout: 10_000 })
  const answered = thread.getByText("The tests passed.")
  await expect(answered).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => sentOf(arc!, banda, only!.id, words)).toBe(1)
  await page.waitForTimeout(1_000)
  await expect(thread.getByText(words, { exact: true })).toHaveCount(1)
  await expect(answered).toHaveCount(1)
  expect(sentOf(arc, banda, only!.id, words)).toBe(1)
  await stopEngine()
})

test("a message whose time ran out while the window was closed is never sent: as the window starts, its words are back in the draft and a toast says so (H5e-2)", async () => {
  test.setTimeout(180_000)
  arc = newArc()
  const banda = await seed(arc)
  const stopEngine = await held(arc)
  window = await withArc(arc)
  // The page's clock runs 20 minutes behind: the message's 10 minutes
  // are up by the time the window starts again on the real one.
  await window.page.clock.install({ time: Date.now() - 20 * 60_000 })
  await window.page.reload()
  const words = "and run them again with 8 shards"
  const until = await waitingOn(window.page, words)
  const [only] = threadsOf(arc, banda)

  window = await again(window, arc)
  const { page } = window
  const thread = benchIn(page)
  // The time it gave up at, with its day where that was yesterday: as it
  // is for a run in the ten minutes after midnight.
  const at = until.slice("until ".length)
  const notSent = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
    .filter({
      hasText: new RegExp(`Not sent: arc was still away at (\\w{3} )?${at}\\.`),
    })
  await expect(notSent).toBeVisible()
  // Its Thread is on screen: no Open.
  await expect(notSent.getByRole("button", { name: "Open" })).toHaveCount(0)
  // Nothing waits that keeps its Harness's name: the Pane says its ID
  // until arc answers (#956).
  const composer = thread.getByRole("textbox", { name: /^Message to / })
  await expect(composer).toHaveText(words)
  await expect.poll(() => draftOf(page, only!.id)).toBe(words)
  await expect(
    thread.getByRole("button", { name: "Send when back" })
  ).toBeVisible()
  await expect(
    thread.getByRole("list", { name: "Waiting for arc" })
  ).toHaveCount(0)
  const pill = thread.locator("[data-machine-pill]")
  await expect(pill).toHaveText("arc is away")

  // arc back, nothing goes there.
  arc.down(false)
  await expect(pill).toHaveCount(0, { timeout: 60_000 })
  await page.waitForTimeout(2_000)
  expect(sentOf(arc, banda, only!.id, words)).toBe(0)
  await expect(composer).toHaveText(words)
  await stopEngine()
})

test("a message queued in a Thread in a window of its own is in this device's one queue: the main window's pill counts it; past its time it comes back in that window; it still waits as its Pane comes back in its place, and arc back, it goes once (#1299)", async () => {
  test.setTimeout(shots ? 300_000 : 180_000)
  arc = newArc()
  const banda = await seed(arc)
  const stopEngine = await held(arc)
  send(arc, banda, "Profile the build")
  await expect
    .poll(() => states(arc!, banda))
    .toContainEqual(["Profile the build", "done"])
  const only = threadsOf(arc, banda).find(
    (one) => one.title === "Bench window tests"
  )!
  window = await withArc(arc)
  const { page, app } = window
  // The clock moves on by hand from here, in each of the app's windows.
  await page.clock.install()
  await page.reload()
  await arcOf(page).getByText("Bench window tests").click()
  const bench = benchIn(page)
  await expect(bench.getByText("You said: Bench window tests")).toBeVisible()

  // Its Thread in a window of its own; another of arc's Threads in the
  // main window.
  await bench.getByRole("button", { name: "Pane menu" }).click()
  const [popped] = await Promise.all([
    app.waitForEvent("window"),
    page.getByRole("menuitem", { name: "In its own window" }).click(),
  ])
  await popped.waitForLoadState()
  const alone = benchIn(popped)
  await expect(alone.getByText("You said: Bench window tests")).toBeVisible()
  await arcOf(page).getByText("Profile the build").click()
  const other = page.getByRole("region", {
    name: "Profile the build",
    exact: true,
  })
  await expect(other.getByText("You said: Profile the build")).toBeVisible()

  // arc goes; a message waits in that window, and the main window's pill
  // counts it, though no Pane there shows its Thread.
  arc.down(true)
  arc.cut()
  const pill = other.locator("[data-machine-pill]")
  await expect(pill).toContainText("arc is away", { timeout: 30_000 })
  await expect(alone.locator("[data-machine-pill]")).toContainText(
    "arc is away",
    { timeout: 30_000 }
  )
  const words = "and run them again with 8 shards"
  const ask = alone.getByRole("textbox", { name: "Message to Fake AI" })
  // Its header stays as it is while the message waits: that window lists
  // no Items.
  const header = await headerShows(alone)
  await ask.fill(words)
  await ask.press("Enter")
  await expect(
    alone.getByRole("list", { name: "Waiting for arc" })
  ).toContainText(words)
  expect(await headerShows(alone)).toEqual(header)
  await expect(pill).toHaveText(/^arc is away( · \d+ min)? · 1 waiting$/)
  await shot(page, "h5e-8")

  // Past its time, the main window gives it back to that window, which
  // has the draft: its words are back in its composer, and its toast is
  // there, with no Open, as its Thread is on screen; none here.
  await page.clock.fastForward("10:00")
  const notSent = popped
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
    .filter({ hasText: /^Not sent: arc was still away at / })
  await expect(notSent).toHaveCount(1)
  await expect(notSent.getByRole("button", { name: "Open" })).toHaveCount(0)
  await expect(ask).toHaveText(words)
  await expect(
    page.getByRole("region", { name: "Notifications" }).getByRole("listitem")
  ).toHaveCount(0)
  await expect(pill).toHaveText(/^arc is away · \d+ min$/)
  await expect.poll(() => draftOf(page, only.id)).toBe(words)
  await ask.press("Enter")
  await expect(
    alone.getByRole("list", { name: "Waiting for arc" })
  ).toContainText(words)
  await expect(pill).toHaveText(/^arc is away · \d+ min · 1 waiting$/)
  await expect(notSent).toHaveCount(1)

  // Its window closed, the Pane is back in its place: the message still
  // waits there, once.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((one) => one.webContents.getURL().includes("#pane/"))
      ?.close()
  )
  const waits = bench.getByRole("list", { name: "Waiting for arc" })
  await expect(waits.getByRole("listitem")).toHaveCount(1)
  await expect(waits).toContainText(words)
  await expect(pill).toHaveText(/^arc is away · \d+ min · 1 waiting$/)

  // arc back: the main window sends it, once.
  arc.down(false)
  await expect(pill).toHaveCount(0, { timeout: 60_000 })
  await expect(waits).toHaveCount(0, { timeout: 10_000 })
  await expect.poll(() => sentOf(arc!, banda, only.id, words)).toBe(1)
  await page.waitForTimeout(2_000)
  expect(sentOf(arc, banda, only.id, words)).toBe(1)
  await stopEngine()
})

test("the counts list and Alt+U place arc's Threads where the sidebar list does, among this machine's (ADR 0079, decision 4; #999)", async () => {
  test.setTimeout(shots ? 300_000 : 120_000)
  arc = newArc()
  const banda = await seed(arc)
  // The Inbox, Your turn oldest first (ADR 0098, decision 3), and the
  // counts always on the bar, beside the sidebar list.
  window = await withArc(
    arc,
    program,
    undefined,
    'preset = "inbox"\n[bar]\nshow = "always"\n'
  )
  const { page } = window
  await work(window)
  const sidebar = sidebarOf(page)
  const done = (title: string) =>
    sidebar
      .getByRole("option", { name: new RegExp(title) })
      .getByRole("img", { name: "Done" })
  await expect(done("Sidebar for arc")).toBeVisible()
  // arc's newest is done after this machine's.
  send(arc, banda, "Done on arc")
  await expect(done("Done on arc")).toBeVisible()
  const titles = [/Bench window tests/, /Sidebar for arc/, /Done on arc/]
  await expect(
    sidebar.getByRole("option", {
      name: /Done on arc|Sidebar for arc|Bench window tests/,
    })
  ).toHaveText(titles)

  // The counts list them in the sidebar list's order, arc's newest last:
  // the Person lists them in the bar's middle (ADR 0098, decision 22).
  writeFileSync(
    join(window.dir, "config/look.toml"),
    'mode = "dark"\n[bar]\ncenter = ["sidebar.counts"]\n'
  )
  await expect(
    page.getByRole("region", { name: "Notifications" }).getByRole("listitem")
  ).toHaveCount(0, { timeout: 30_000 })
  const counts = page.getByRole("banner").getByRole("button", { name: /done/ })
  await expect(counts).toHaveAccessibleName("3 done")
  await counts.click()
  const waiting = page.getByRole("group", { name: "Your turn" })
  await expect(waiting.getByRole("menuitem")).toHaveCount(3)
  await shot(page, "order-elsewhere-counts")
  await expect(waiting.getByRole("menuitem")).toHaveText(titles)
  await page.keyboard.press("Escape")
  await expect(waiting).toBeHidden()

  // Alt+U walks them in that order too, arc's on arc's engine.
  for (const title of [
    "Bench window tests",
    "Sidebar for arc",
    "Done on arc",
  ]) {
    await page.keyboard.press("Alt+U")
    const pane = page.getByRole("region", { name: title, exact: true })
    await expect(pane).toHaveAttribute("data-focused", "true")
    await expect(pane.getByText(`You said: ${title}`)).toBeVisible()
  }
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

  // Stop Banda on arc: its engine stops, and the foot's dot says so.
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as Paged).banda.hostStop("arc", false)
    )
  ).toBe("stopped")
  await expect(dotOf(page)).toHaveAttribute("title", STOPPED)

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

  // It stays awake while Agents work, as Banda does by itself; and while
  // plugged in once the Person turns it on, in its machine.toml. Turned
  // back, the line goes; by hand, the switch follows, one the Person
  // turned too (ADR 0097).
  const working = here.getByRole("switch", {
    name: "Stay awake while Agents work",
  })
  const plugged = here.getByRole("switch", {
    name: "Stay awake while plugged in",
  })
  await expect(working).toHaveAttribute("aria-checked", "true")
  await expect(plugged).toHaveAttribute("aria-checked", "false")
  await settingsShot(page, "1-this-machine")
  await plugged.click()
  await expect
    .poll(() => readFileSync(ours, "utf8"))
    .toMatch(/^awake-plugged-in = true$/m)
  await expect(plugged).toHaveAttribute("aria-checked", "true")
  await plugged.click()
  await expect
    .poll(() => readFileSync(ours, "utf8"))
    .not.toMatch(/awake-plugged-in/)
  await expect(plugged).toHaveAttribute("aria-checked", "false")
  writeFileSync(
    ours,
    `${readFileSync(ours, "utf8")}awake-plugged-in = true\nawake-while-working = false\n`
  )
  await expect(plugged).toHaveAttribute("aria-checked", "true")
  await expect(working).toHaveAttribute("aria-checked", "false")
  await working.click()
  await expect
    .poll(() => readFileSync(ours, "utf8"))
    .not.toMatch(/awake-while-working/)
  await expect(working).toHaveAttribute("aria-checked", "true")
  // Turned by the keys, it keeps the focus while it is written.
  await plugged.focus()
  await page.keyboard.press("Space")
  await expect
    .poll(() => readFileSync(ours, "utf8"))
    .not.toMatch(/awake-plugged-in/)
  await expect(plugged).toHaveAttribute("aria-checked", "false")
  await expect(plugged).toBeFocused()

  // The Banda menu's Machine settings opens arc's row, where Test finds
  // arc, its system and its own name.
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await bandaMenu(page)
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
  // Its battery while it is live: the percent in its header, and a line
  // in full with why it is awake; where it has none, no percent, and why
  // it is awake on its own line, as Awake (ADR 0097).
  const top = row.getByRole("button", { expanded: true })
  const battery = row.locator('[data-key="arc.battery"]')
  const awakeRow = row.locator('[data-key="arc.awake"]')
  const why = /Kept awake: |Sleeps by itself when idle\./
  const withBattery = batteryHere()
  if (withBattery) {
    await expect(top).toContainText(/\d+% ·/)
    await expect(battery).toContainText("Battery")
    await expect(battery).toContainText(/\d+% · (on battery|charging|on power)/)
    await expect(battery).toContainText(why)
    await expect(awakeRow).toHaveCount(0)
  } else {
    await expect(battery).toHaveCount(0)
    await expect(top).not.toContainText("%")
    await expect(awakeRow).toContainText("Awake")
    await expect(awakeRow).toContainText(why)
  }
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

  // Kept awake on power, on arc: its machine.toml has it (ADR 0097).
  const awake = row.getByRole("switch", { name: "Stay awake while plugged in" })
  await expect(awake).toHaveAttribute("aria-checked", "false")
  await awake.click()
  await expect
    .poll(() => readFileSync(arcs, "utf8"))
    .toMatch(/^awake-plugged-in = true$/m)
  await expect(awake).toHaveAttribute("aria-checked", "true")

  // Away, it is renamed only once it is back.
  arc.down(true)
  arc.cut()
  await expect(row.getByRole("button", { expanded: true })).toContainText(
    "away"
  )
  // Away, no battery and no why: the last heard is no longer true.
  await expect(top).not.toContainText("%")
  await expect(battery).toHaveCount(0)
  await expect(awakeRow).toHaveCount(0)
  await expect(row.getByRole("button", { name: "Edit" })).toBeDisabled()
  await expect(row).toContainText("Rename arc when it is back.")
  // Away, it is off and still: what arc said is no longer known.
  await expect(awake).toBeDisabled()
  await expect(awake).toHaveAttribute("aria-checked", "false")
  await expect(row).toContainText("Set it on arc when it is back.")
  await expect(
    row.getByRole("button", { name: "Stop Banda on arc" })
  ).toHaveCount(0)
  await settingsShot(page, "4-away")
  arc.down(false)
  await expect(row.getByRole("button", { expanded: true })).toContainText(
    "live · same build",
    { timeout: 60_000 }
  )
  // Back, it is heard again.
  await expect(battery).toHaveCount(withBattery ? 1 : 0)
  await expect(awakeRow).toHaveCount(withBattery ? 0 : 1)
  // Back, as arc says it; turned off there, its line goes.
  await expect(awake).toHaveAttribute("aria-checked", "true")
  await awake.click()
  await expect
    .poll(() => readFileSync(arcs, "utf8"))
    .not.toMatch(/awake-plugged-in/)
  await expect(awake).toHaveAttribute("aria-checked", "false")

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

  // Two acts at once in its row: a Test main holds, and an address
  // refused meanwhile. The refusal ends first and the Test runs on, so
  // the row stays busy and says so until the Test ends too (#966).
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("hostTest")
    ipcMain.handle(
      "hostTest",
      () =>
        new Promise((done) => {
          ;(globalThis as { tested?: (test: unknown) => void }).tested = done
        })
    )
  })
  const testing = row.getByRole("button", { name: "Test connection" })
  await testing.click()
  await expect(row).toContainText("Testing Cloud 2…")
  const address = row.getByRole("textbox", { name: "Cloud 2's address" })
  await address.fill("not an address")
  await address.press("Enter")
  await expect(row.getByRole("alert")).toContainText("`ssh` is not")
  await expect(testing).toBeDisabled()
  await expect(row).toContainText("Testing Cloud 2…")
  await app.evaluate(() =>
    (globalThis as { tested?: (test: unknown) => void }).tested?.({
      state: "away",
      why: "held",
    })
  )
  await expect(row.getByRole("status")).toContainText("No answer: held")
  await expect(testing).toBeEnabled()
  // What went wrong stays until the next act starts.
  await expect(row.getByRole("alert")).toContainText("`ssh` is not")
  expect(readFileSync(hostsFile, "utf8")).toBe(
    '[[hosts]]\nname = "arc"\nssh = "arc"\n'
  )
})

test("Settings → Machines, Show: only with another machine; how it shows on its cards changes them at once, Off on a card of one line too; a search lands on it, and Name this machine too names this one", async () => {
  test.setTimeout(shots ? 300_000 : 180_000)
  arc = newArc()
  const banda = await seed(arc)
  window = await startWindow({
    look: 'mode = "dark"\n',
    sidebar: 'preset = "inbox"\n',
    files: { "config/machine.toml": 'name = "mac"\nicon = "laptop"\n' },
    env: { PATH: `${arc.bin}:${process.env.PATH}` },
  })
  const { page } = window
  const shownIn = join(window.dir, "config/sidebar.toml")
  const hostsFile = join(window.dir, "config/hosts.toml")
  const sidebar = sidebarOf(page)
  await work(window)
  await expect(sidebar.getByText("Sidebar for arc")).toBeVisible()

  // One machine: no Show card, and a search finds neither of its keys.
  await sidebar.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByRole("region", { name: "Settings", exact: true })
  const section = (name: RegExp) =>
    settings
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name })
  await section(/Machines/).click()
  if (shots) await page.keyboard.press("Alt+KeyF")
  const show = settings.getByRole("group", { name: "Show", exact: true })
  await expect(
    settings.getByRole("group", { name: "Other machines" })
  ).toBeVisible()
  await expect(show).toHaveCount(0)
  const search = settings.getByRole("textbox", { name: "Search settings" })
  await search.fill("machine on rows")
  await expect(settings).toContainText("No setting says")
  await search.fill("")
  await settingsShot(page, "show-none")

  // Another machine: the card is the last, in its words, and Settings →
  // Sidebar shows neither key.
  writeFileSync(
    hostsFile,
    `[[hosts]]\nname = "arc"\nssh = "arc"\nbanda = ${JSON.stringify(program)}\n`
  )
  await expect(show).toBeVisible()
  await expect(show).toContainText(
    "sidebar.toml on mac: how windows on mac name the machines."
  )
  await expect(show).toContainText("How another machine shows on its rows.")
  await expect(show).toContainText(
    "A label over mac's Projects, its name on its rows and in its Panes."
  )
  await settingsScrolledTo(show)
  await settingsShot(page, "show-card")
  const cardKeys = settings.locator('[data-key^="machines."]')
  await section(/Sidebar/).click()
  await expect(cardKeys).toHaveCount(0)
  await section(/Machines/).click()
  await expect(show).toBeVisible()

  // The search finds them now, and lands on the row, lit.
  await search.fill("name this machine")
  await settings
    .getByRole("button")
    .filter({ hasText: "Name this machine too" })
    .click()
  await expect(section(/Machines/)).toHaveAttribute("aria-current", "page")
  await expect(show.locator('[data-key="machines.this-too"]')).toHaveClass(
    /bg-accent\/60/
  )

  // How another machine shows on its cards, changed live, in the file: on
  // a card of three lines by its icon and name, on one of one line, as a
  // Thread at work there, by its icon alone.
  await expect(sidebar.getByText("Bench window tests")).toBeVisible()
  send(arc, banda, "Hosts over ssh, wait")
  const arcRow = sidebar
    .getByRole("option")
    .filter({ hasText: "Bench window tests" })
  const mark = arcRow.locator('[data-machine-card="arc"]')
  const name = mark.locator(".max-w-16")
  const atWork = sidebar
    .getByRole("option")
    .filter({ hasText: "Hosts over ssh, wait" })
  const workMark = atWork.locator('[data-machine-card="arc"]')
  const choice = show.getByRole("radiogroup", { name: "Machine on rows" })
  const pick = (words: string) =>
    choice.getByRole("radio", { name: words, exact: true })
  await expect(pick("Icon and name")).toHaveAttribute("aria-checked", "true")
  await expect(name).toHaveText("arc")
  await expect(workMark.locator('[data-machine-icon="server"]')).toBeVisible()
  await expect(workMark.locator(".max-w-16")).toHaveCount(0)
  await shot(page, "show-rows-named")
  await pick("Icon").click()
  await expect
    .poll(() => readFileSync(shownIn, "utf8"))
    .toMatch(/rows = "icon"/)
  await expect(pick("Icon")).toHaveAttribute("aria-checked", "true")
  await expect(mark).toBeVisible()
  await expect(mark.locator('[data-machine-icon="server"]')).toBeVisible()
  await expect(name).toHaveCount(0)
  await expect(workMark).toBeVisible()
  await shot(page, "show-rows-icon")
  // Off is on no card, of one line too.
  await pick("Off").click()
  await expect(mark).toHaveCount(0)
  await expect(atWork).toBeVisible()
  await expect(workMark).toHaveCount(0)
  await shot(page, "show-rows-off")

  // Written by hand, the card follows; with Off, arc's label still names
  // it.
  writeFileSync(shownIn, 'preset = "inbox"\n[machines]\nrows = "named"\n')
  await expect(pick("Icon and name")).toHaveAttribute("aria-checked", "true")
  await expect(name).toHaveText("arc")
  writeFileSync(shownIn, 'preset = "projects"\n[machines]\nrows = "off"\n')
  await expect(
    arcOf(page).locator('[data-machine-icon="server"]').first()
  ).toBeVisible()

  // Name this machine too: its rows, as the same choice has them, a label
  // over its Projects, and its Panes' headers.
  writeFileSync(shownIn, 'preset = "inbox"\n')
  await show.getByRole("switch", { name: "Name this machine too" }).click()
  await expect
    .poll(() => readFileSync(shownIn, "utf8"))
    .toMatch(/this-too = true/)
  const ours = sidebar
    .getByRole("option")
    .filter({ hasText: "Sidebar for arc" })
  await expect(ours.locator('[data-machine-icon="laptop"]')).toBeVisible()
  await expect(ours.locator(".max-w-16")).toHaveText("mac")
  await shot(page, "show-this-too-inbox")
  await pick("Off").click()
  await expect(ours.locator('[data-machine-icon="laptop"]')).toHaveCount(0)

  writeFileSync(shownIn, 'preset = "projects"\n[machines]\nthis-too = true\n')
  const macOf = sidebar.getByRole("group", { name: "mac", exact: true })
  await expect(macOf.getByText("Sidebar for arc")).toBeVisible()
  await expect(arcOf(page).getByText("Bench window tests")).toBeVisible()
  // The label says it: the rows under it carry no machine.
  await expect(macOf.locator('[data-machine-icon="laptop"]')).toHaveCount(1)
  await shot(page, "show-this-too-projects")
  await macOf.getByText("Sidebar for arc").click()
  const thread = page.getByRole("region", {
    name: "Sidebar for arc",
    exact: true,
  })
  await expect(
    thread.locator('[data-machine-icon="laptop"]').first()
  ).toBeVisible()
  await shot(page, "show-this-too-pane")

  // arc's Thread of no Project stands in the No Project group, under this
  // machine's label, and still names arc: the label names only this
  // machine's cards.
  await page.keyboard.press("Alt+Enter")
  const draft = page
    .getByRole("region", { name: "New Thread" })
    .and(page.locator('[data-focused="true"]'))
  await draft.getByRole("button", { name: /^Project: / }).click()
  await page
    .getByRole("menu")
    .getByRole("group", { name: /^arc/ })
    .getByRole("menuitemradio", { name: /^No Project/ })
    .click()
  await expect(
    draft.getByRole("button", { name: "Project: No Project on arc" })
  ).toBeVisible()
  const composer = draft.getByRole("textbox", { name: "Message to Fake AI" })
  await composer.fill("Scratch on arc")
  await composer.press("Enter")
  await expect(
    page
      .getByRole("region", { name: "Scratch on arc", exact: true })
      .getByText("You said: Scratch on arc")
  ).toBeVisible()
  // arc's new Project shows as arc says so (ADR 0127), once the pointer
  // the ✎ menu left over the list lets it move (ADR 0098).
  await leaveSidebar(page)
  const scratch = macOf
    .getByRole("option")
    .filter({ hasText: "Scratch on arc" })
  await expect(scratch.locator('[data-machine-card="arc"]')).toBeVisible()
  await expect(scratch.locator('[data-machine-icon="laptop"]')).toHaveCount(0)
  await shot(page, "show-this-too-scratch")

  // Turned off, this machine's name goes everywhere; its Pane's too.
  writeFileSync(shownIn, 'preset = "projects"\n')
  await expect(macOf).toHaveCount(0)
  await expect(thread.locator('[data-machine-icon="laptop"]')).toHaveCount(0)
})
