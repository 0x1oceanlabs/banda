/**
 * Banda's ad blocker, in the browser's profiles: Ghostery's engine with
 * EasyList, EasyPrivacy and uBlock Origin's lists. It drops the requests
 * the lists name in every profile, and hides the elements they name in
 * the Person's. `blocker` in browser.toml turns it on and off.
 *
 * Ghostery's Electron part hides elements in one session only: it serves
 * their pages on channels of the whole process, which a second session
 * cannot take. So the profiles of a Project's Agents (ADR 0083, decision
 * 4) get its request filter alone, as Ghostery sets it up in a session.
 *
 * The engine is fetched once a day and kept in the window's folder, so a
 * start without the network still blocks with the lists it had.
 */
import { readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { PARTITION } from "@banda/browser-pane/desktop"
import { ElectronBlocker } from "@ghostery/adblocker-electron"
import { app, type Session, session } from "electron"

/** How long the lists kept on disk are used before they are fetched again. */
const FRESH = 24 * 60 * 60 * 1000

export class Blocker {
  #engine: Promise<ElectronBlocker | null> | null = null
  /** Whether browser.toml last said to block. */
  #on = false
  /** The profiles of Projects' Agents. */
  readonly #agents = new Set<Session>()

  /** Blocks, or stops, as browser.toml says. The first time it is on, the
   * lists load; pages open meanwhile. Calls finish in the order made. */
  async set(on: boolean): Promise<void> {
    this.#on = on
    if (!on && !this.#engine) return
    const engine = await (this.#engine ??= load())
    if (!engine) return
    const profile = session.fromPartition(PARTITION)
    if (on) engine.enableBlockingInSession(profile)
    else if (engine.isBlockingEnabled(profile))
      engine.disableBlockingInSession(profile)
    for (const agents of this.#agents) filter(agents, on ? engine : null)
  }

  /** Blocks in `profile`, a Project's Agents', while it blocks in the
   * Person's. */
  async add(profile: Session): Promise<void> {
    this.#agents.add(profile)
    const engine = await this.#engine
    if (engine) filter(profile, this.#on ? engine : null)
  }
}

/** Drops in `profile` the requests `engine`'s lists name; none with no
 * engine. */
function filter(profile: Session, engine: ElectronBlocker | null): void {
  const every = { urls: ["<all_urls>"] }
  if (engine) {
    profile.webRequest.onBeforeRequest(every, engine.onBeforeRequest)
    profile.webRequest.onHeadersReceived(every, engine.onHeadersReceived)
  } else {
    profile.webRequest.onBeforeRequest(null)
    profile.webRequest.onHeadersReceived(null)
  }
}

/** The engine: the lists on disk while fresh, or fetched; the old ones
 * when the fetch fails; none when there are none. `BANDA_BLOCK_LIST`
 * names a file of filters to use instead, for the tests. */
async function load(): Promise<ElectronBlocker | null> {
  const list = process.env.BANDA_BLOCK_LIST
  if (list) return ElectronBlocker.parse(await readFile(list, "utf8"))
  const file = join(app.getPath("userData"), "blocker.bin")
  const kept = () =>
    readFile(file)
      .then((bytes) => ElectronBlocker.deserialize(bytes))
      .catch(() => null)
  const age = await stat(file).then(
    (about) => Date.now() - about.mtimeMs,
    () => Infinity
  )
  if (age < FRESH) {
    const engine = await kept()
    if (engine) return engine
  }
  try {
    const engine = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)
    writeFile(file, engine.serialize()).catch((error) =>
      console.error(`banda: the blocker's lists were not kept: ${error}`)
    )
    return engine
  } catch (error) {
    console.error(`banda: the blocker's lists did not load: ${error}`)
    return kept()
  }
}
