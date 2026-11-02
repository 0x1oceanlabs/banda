/**
 * Banda's ad blocker, in the browser's profile: Ghostery's engine with
 * EasyList, EasyPrivacy and uBlock Origin's lists. It drops the requests
 * the lists name and hides the elements they name. `blocker` in
 * browser.toml turns it on and off.
 *
 * The engine is fetched once a day and kept in the window's folder, so a
 * start without the network still blocks with the lists it had.
 */
import { readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { PARTITION } from "@banda/browser-pane/desktop"
import { ElectronBlocker } from "@ghostery/adblocker-electron"
import { app, session } from "electron"

/** How long the lists kept on disk are used before they are fetched again. */
const FRESH = 24 * 60 * 60 * 1000

export class Blocker {
  #engine: Promise<ElectronBlocker | null> | null = null

  /** Blocks, or stops, as browser.toml says. The first time it is on, the
   * lists load; pages open meanwhile. Calls finish in the order made. */
  async set(on: boolean): Promise<void> {
    if (!on && !this.#engine) return
    const engine = await (this.#engine ??= load())
    if (!engine) return
    const profile = session.fromPartition(PARTITION)
    if (on) engine.enableBlockingInSession(profile)
    else if (engine.isBlockingEnabled(profile))
      engine.disableBlockingInSession(profile)
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
