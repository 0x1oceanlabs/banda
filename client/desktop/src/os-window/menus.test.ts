import { vi } from "vitest"

vi.mock("electron", () => ({ app: {}, Menu: {}, ipcMain: {} }))
import { expect, it } from "@effect/vitest"
import type { EngineStatus } from "@banda/contract"
import { Engine } from "@banda/desktop-kit"
import {
  Deferred,
  Effect,
  Exit,
  Layer,
  Schema,
  Scope,
  SubscriptionRef,
} from "effect"
import type { BrowserWindow, IpcMainEvent } from "electron"
import { Acts } from "../acts"
import { BRIDGE } from "../bridge"
import type { Commands } from "../door"
import { Status } from "../status"
import type { MenuBarDoes } from "../tray"
import { menuAnswers, type Menus, menusLayer } from "./menus"
import { Windows } from "./windows"

/** Lets what a click started, and what the layer forked, run. */
const settled = Effect.yieldNow.pipe(Effect.repeat({ times: 20 }))

/**
 * The menus and the door faked on `platform`, over fakes that say what
 * they `did` among the menus': the windows, whose main one is `open`, the
 * page's actions, the status, which `says` each new one, and the engine,
 * which names the door's path when told (`names`).
 */
function on(platform: NodeJS.Platform, { open = true, headless = false } = {}) {
  const did: string[] = []
  const window = {
    webContents: {
      send: (name: string, value: unknown) =>
        void did.push(`page: ${name} ${String(value)}`),
    },
  } as unknown as BrowserWindow
  const main = () => (open ? window : null)
  /** What the fake system holds: its app menu's Banda, the menu bar's
   * items, and the door's commands. */
  const held: {
    banda?: (() => void) | null
    bar?: MenuBarDoes
    door?: Commands
  } = {}
  const menus: Menus = {
    platform,
    headless,
    appMenu: (banda) => {
      held.banda = banda
      did.push(banda ? "app menu" : "no app menu")
    },
    menuBar: (does) => {
      held.bar = does
      did.push("icon")
      return {
        show: (status) =>
          void did.push(`shows ${status ? status.version : "nothing"}`),
        destroy: () => {
          delete held.bar
          did.push("no icon")
        },
      }
    },
    door: (path, commands) => {
      held.door = commands
      did.push(`door at ${path}`)
      return () => {
        delete held.door
        did.push("door shut")
      }
    },
    quit: () => void did.push("quit"),
  }
  const now = Effect.runSync(SubscriptionRef.make<EngineStatus | null>(null))
  const door = Effect.runSync(Deferred.make<string>())
  const under = Layer.mergeAll(
    Layer.succeed(Windows)({
      main,
      began: () => open,
      inFront: () => {
        if (main()) did.push("in front")
        return main()
      },
      open: () => Effect.succeed(window),
      openBanda: Effect.sync(() => {
        did.push("open Banda")
        return window
      }),
      page: () => Effect.succeed(window),
    }),
    Layer.succeed(Status)({
      current: SubscriptionRef.get(now),
      changes: SubscriptionRef.changes(now),
    }),
    Layer.succeed(Engine)({
      address: Effect.die("unused"),
      client: Effect.die("unused"),
      door: Deferred.await(door),
    }),
    Layer.succeed(Acts)({
      run: (action, args) =>
        Effect.sync(
          () => void did.push(`page: ${action} ${JSON.stringify(args)}`)
        ),
      answered: () => Effect.void,
    })
  )
  return {
    did,
    held,
    says: (version: string) =>
      SubscriptionRef.set(now, { running: true, version } as EngineStatus),
    names: (path: string) => Deferred.succeed(door, path),
    under,
    layer: menusLayer(menus).pipe(Layer.provideMerge(under)),
  }
}

it.effect(
  "macOS has an app menu, whose Banda brings the window to the front; Linux and Windows have none, and Banda's icon is on all three",
  () => {
    const mac = on("darwin")
    const linux = on("linux")
    const windows = on("win32")
    return Effect.gen(function* () {
      yield* Effect.sync(() => {
        expect(mac.did).toEqual(["app menu", "icon"])
        mac.held.banda?.()
        expect(mac.did.slice(2)).toEqual(["in front"])
      }).pipe(Effect.provide(mac.layer))
      yield* settled.pipe(Effect.provide(linux.layer))
      yield* settled.pipe(Effect.provide(windows.layer))
      expect([linux.did, windows.did]).toEqual([
        ["no app menu", "icon", "shows nothing", "no icon"],
        ["no app menu", "icon", "shows nothing", "no icon"],
      ])
      // A system with neither a menu bar nor a tray has no icon, nor
      // has a Linux window with no screen.
      for (const none of [on("freebsd"), on("linux", { headless: true })]) {
        yield* settled.pipe(Effect.provide(none.layer))
        expect(none.did).toEqual(["no app menu"])
      }
    })
  }
)

it.effect(
  "the menu bar's icon shows each status; Open Banda opens the window, a row opens it and then its Thread there, and Quit Banda asks the app to quit",
  () => {
    const { did, held, says, layer } = on("darwin")
    return Effect.gen(function* () {
      yield* settled
      yield* says("1.0.0")
      yield* settled
      yield* says("1.0.1")
      yield* settled
      expect(did.slice(2)).toEqual([
        "shows nothing",
        "shows 1.0.0",
        "shows 1.0.1",
      ])
      did.length = 0
      held.bar?.open()
      held.bar?.openThread("work", "t1", "A title")
      yield* settled
      held.bar?.quit()
      expect(did).toEqual([
        "open Banda",
        "open Banda",
        `page: pane.pick ${JSON.stringify({
          project: "work",
          pane: {
            kind: "agents.thread",
            args: { thread: "t1", harness: "", title: "A title" },
          },
        })}`,
        "quit",
      ])
    }).pipe(Effect.provide(layer))
  }
)

it.effect(
  "the door opens once the engine names it, and banda menu opens the menu at its route in the window, brought to the front",
  () => {
    const { did, held, names, layer } = on("linux")
    return Effect.gen(function* () {
      yield* settled
      expect(held.door).toBeUndefined()
      // The icon is there by now, with nothing to show.
      did.length = 0
      yield* names("/run/banda/window.sock")
      yield* settled
      expect(did).toEqual(["door at /run/banda/window.sock"])
      expect(Object.keys(held.door ?? {})).toEqual(["menu"])
      expect(held.door?.menu("settings.appearance")).toBe("ok")
      expect(did.slice(1)).toEqual([
        "in front",
        `page: ${BRIDGE.menu.listen.name} settings.appearance`,
      ])
      expect(held.door?.menu(7)).toBe("the route is not a string")
      expect(did).toHaveLength(3)
    }).pipe(Effect.provide(layer))
  }
)

it.effect("with no window, banda menu says so", () => {
  const { did, held, names, layer } = on("linux", { open: false })
  return Effect.gen(function* () {
    yield* names("door")
    yield* settled
    did.length = 0
    expect(held.door?.menu("actions")).toBe("no window")
    expect(did).toEqual([])
  }).pipe(Effect.provide(layer))
})

it.effect("the page's menu.open is answered as banda menu is", () => {
  const { did, under } = on("linux")
  const [args, answer] = menuAnswers.open
  return Effect.gen(function* () {
    const sent = yield* Schema.decodeUnknownEffect(args)(["actions"])
    expect(yield* answer(sent, {} as IpcMainEvent)).toBe("ok")
    expect(did).toEqual([
      "in front",
      `page: ${BRIDGE.menu.listen.name} actions`,
    ])
  }).pipe(Effect.provide(under))
})

it.effect(
  "the icon and the door are there only while main runs; a door the engine never named is never opened",
  () => {
    const named = on("darwin")
    const unnamed = on("darwin")
    return Effect.gen(function* () {
      const scope = yield* Scope.make()
      yield* Layer.buildWithScope(named.layer, scope)
      yield* named.names("door")
      yield* settled
      named.did.length = 0
      yield* Scope.close(scope, Exit.void)
      expect(named.did.toSorted()).toEqual(["door shut", "no icon"])
      // What the status says from then on is shown nowhere.
      yield* named.says("1.0.0")
      yield* settled
      expect(named.did).toHaveLength(2)
      expect(named.held).toEqual({ banda: named.held.banda })

      const other = yield* Scope.make()
      yield* Layer.buildWithScope(unnamed.layer, other)
      yield* settled
      yield* Scope.close(other, Exit.void)
      yield* unnamed.names("door")
      yield* settled
      expect(unnamed.did).toEqual([
        "app menu",
        "icon",
        "shows nothing",
        "no icon",
      ])
    })
  }
)
