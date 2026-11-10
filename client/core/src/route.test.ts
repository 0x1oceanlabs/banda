import type { ProjectId } from "@banda/contract"
import { afterEach, expect, test, vi } from "vitest"
import { FORGETTING, KeptHosts } from "./hosts"
import { type Act, deviceFor, type From, routeAct } from "./route"
import { away, desktop, live, project, Socket } from "./testing"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** An App's act, as Threads' Later. */
const later: Act = {
  title: "Put the Thread off",
  at: "owner",
  app: "agents",
  here: true,
}
/** An App arc's build lacks, as an older one would. */
const diff: Act = { title: "Diff", at: "owner", app: "git", here: true }
/** The device's, as its browser. */
const browse: Act = { title: "Open in a browser", at: "device", here: true }
/** The window's own, as a Pane's close; its own on a file, as Show in
 * folder, whose file is of Here's Project where its args name none; and
 * its own on this machine's engine, as Add Project, which takes no
 * Project of Here's. */
const close: Act = { title: "Close the Pane", at: "window" }
const folder: Act = {
  title: "Show a file in its folder",
  at: "device",
  here: true,
}
const add: Act = { title: "Add Project", at: "device" }

/** This machine with "mine" and its Host scope m0; arc live with "r1" and
 * its No Project's Host scope m1, its engine open with Threads alone, as
 * an older build without Git. */
async function machines() {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, FORGETTING)
  hosts.follow()
  tell([live])
  hosts.ours([project("mine")], "m0" as ProjectId)
  hosts.projects("arc", [project("r1"), project("mine")])
  const watch = vi.spyOn(hosts.engine("arc"), "watch")
  // Asked before arc said, it is not taken for missing an App; asked again
  // on every draw while arc has not said, it watches arc once.
  expect(hosts.modulesOf("arc")).toBeUndefined()
  expect(hosts.modulesOf("arc")).toBeUndefined()
  expect(watch).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(0)
  Socket.opened[0]!.say({
    type: "welcome",
    engine: "0.1.0",
    modules: ["agents"],
    machine: "m1",
    boot: "b1",
  })
  return { hosts, tell }
}

const onArc: From = {
  pane: { project: "r1" as ProjectId, pane: { args: { host: "arc" } } },
}
const onMine: From = { pane: { project: "mine" as ProjectId } }

test("an act goes to the machine its Project is on: this machine's, arc's, or a machine's own by its Host scope", async () => {
  const { hosts } = await machines()
  expect(routeAct(hosts, later, onMine)).toEqual({
    runs: true,
    args: { project: "mine" },
  })
  expect(routeAct(hosts, later, onArc, { item: "t1" })).toEqual({
    runs: true,
    args: { item: "t1", project: "r1" },
    host: "arc",
  })
  // From a key, Here's Project, by the host its Pane is on.
  expect(routeAct(hosts, later, { here: onArc.pane })).toMatchObject({
    runs: true,
    host: "arc",
  })
  // A machine's own, by its Host scope's ID: arc's, and this machine's.
  for (const [machine, host] of [
    ["m1", "arc"],
    ["m0", undefined],
  ] as const)
    expect(
      routeAct(hosts, later, { pane: { machine: machine as ProjectId } })
    ).toEqual({ runs: true, args: undefined, ...(host && { host }) })
  // A file of Here's Project is arc's, from a key as from arc's Pane; Add
  // Project, of no Project, and the window's own run here.
  for (const from of [onArc, { here: onArc.pane }])
    expect(routeAct(hosts, folder, from, { file: "/a" })).toMatchObject({
      runs: false,
      said: "Not on arc yet: Show a file in its folder",
    })
  expect(routeAct(hosts, add, { here: onArc.pane })).toEqual({
    runs: true,
    args: undefined,
  })
  expect(routeAct(hosts, close, onArc)).toEqual({
    runs: true,
    args: undefined,
  })
  hosts.engine("arc").close()
})

test("args that name no Project take the Pane's; a key's take the Project its args name, on any machine", async () => {
  const { hosts } = await machines()
  expect(routeAct(hosts, later, onArc, { until: 5 })).toEqual({
    runs: true,
    args: { until: 5, project: "r1" },
    host: "arc",
  })
  expect(
    routeAct(hosts, later, { here: onMine.pane }, { project: "r1", item: "t" })
  ).toMatchObject({ runs: true, host: "arc" })
  // A Project arc has not listed yet, named by arc's Pane, is arc's: never
  // this machine's in its place.
  expect(
    routeAct(hosts, later, onArc, { project: "s9", item: "t" })
  ).toMatchObject({ runs: true, host: "arc" })
  // So is it as the act comes again through the window's run, from that
  // Pane in focus; a key's on another Project is placed by its own.
  const arcPane = {
    project: "s9" as ProjectId,
    pane: { args: { host: "arc" } },
  }
  expect(
    routeAct(hosts, later, { here: arcPane }, { project: "s9" })
  ).toMatchObject({ runs: true, host: "arc" })
  expect(
    routeAct(hosts, later, { here: arcPane }, { project: "mine" })
  ).toEqual({ runs: true, args: { project: "mine" } })
  hosts.engine("arc").close()
})

test("a Pane's values are its owner's: a Project of another machine it names is refused, in words", async () => {
  const { hosts, tell } = await machines()
  // "mine" is this machine's, which wins the ID arc has too.
  expect(routeAct(hosts, later, onArc, { project: "mine" })).toEqual({
    runs: false,
    why: "That is not on arc",
    said: "That is not on arc",
  })
  expect(routeAct(hosts, close, onMine, { project: "r1" })).toMatchObject({
    runs: false,
    why: "That is not on this machine",
  })
  // A third machine's Project is studio's, as studio lists it: arc's Pane
  // does not lend it arc, so it is refused, not placed on arc and then
  // run on studio as the window's run places it again from Here.
  tell([live, { ...live, name: "studio", ssh: "studio" }])
  hosts.projects("studio", [project("x1")])
  expect(
    routeAct(hosts, later, onArc, { project: "x1", item: "t9" })
  ).toMatchObject({ runs: false, why: "That is not on arc" })
  hosts.engine("arc").close()
})

test("an owner the Window does not know fails closed, never on this machine", async () => {
  const { hosts } = await machines()
  const gone: From = {
    pane: { project: "g1" as ProjectId, pane: { args: { host: "gone" } } },
  }
  expect(routeAct(hosts, later, gone)).toMatchObject({
    runs: false,
    said: "This window does not reach gone",
  })
  expect(
    routeAct(hosts, later, { pane: { machine: "m7" as ProjectId } })
  ).toMatchObject({
    runs: false,
    said: "This window does not reach that machine",
  })
  // Its own close still runs: it is the window's.
  expect(routeAct(hosts, close, gone)).toMatchObject({ runs: true })
  // A Project no machine the Window knows has, as the directory keeps
  // none and no old args name one, named by a key or by this machine's
  // Pane: refused, never run on this machine (ADR 0106, decision 1).
  for (const from of [onMine, { here: onMine.pane }])
    expect(routeAct(hosts, later, from, { project: "zz" })).toEqual({
      runs: false,
      why: "This window does not reach that machine",
      said: "This window does not reach that machine",
    })
  expect(
    routeAct(hosts, later, { here: { project: "zz" as ProjectId } })
  ).toMatchObject({ runs: false })
  hosts.engine("arc").close()
})

test("an App arc does not run, or the device's, is not on arc yet, and the toast says which act", async () => {
  const { hosts, tell } = await machines()
  expect(routeAct(hosts, diff, onArc)).toEqual({
    runs: false,
    why: "Not on arc yet",
    said: "Not on arc yet: Diff",
  })
  expect(routeAct(hosts, browse, onArc, { address: "x" })).toEqual({
    runs: false,
    why: "Not on arc yet",
    said: "Not on arc yet: Open in a browser",
  })
  // From a key, on arc's Project as Here is, the same.
  expect(routeAct(hosts, browse, { here: onArc.pane })).toMatchObject({
    said: "Not on arc yet: Open in a browser",
  })
  // On this machine both run.
  expect(routeAct(hosts, diff, onMine)).toMatchObject({ runs: true })
  expect(routeAct(hosts, browse, onMine)).toMatchObject({ runs: true })
  // Away, arc is known by what it said last; an App it has goes, and
  // fails at once there, in its own words.
  tell([away])
  expect(hosts.modulesOf("arc")).toEqual(["agents"])
  expect(routeAct(hosts, diff, onArc)).toMatchObject({ runs: false })
  expect(routeAct(hosts, later, onArc)).toMatchObject({
    runs: true,
    host: "arc",
  })
  hosts.engine("arc").close()
})

test("a Pane's device says a file is this computer's only where its Project is this machine's", async () => {
  const { hosts } = await machines()
  const has = () => true
  const here = deviceFor(hosts, onMine.pane, has)
  expect(here.local({ project: "mine" as ProjectId, path: "/mine/a" })).toBe(
    "/mine/a"
  )
  const there = deviceFor(hosts, onArc.pane, has)
  expect(
    there.local({ project: "r1" as ProjectId, path: "/r1/a" })
  ).toBeUndefined()
  // Unlisted on arc yet, a file of arc's Pane is arc's, not this one's.
  expect(
    there.local({ project: "s9" as ProjectId, path: "/s9/a" })
  ).toBeUndefined()
  expect(there.has("clipboard")).toBe(true)
  hosts.engine("arc").close()
})
