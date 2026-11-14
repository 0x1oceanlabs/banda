// @vitest-environment happy-dom
/**
 * The kit holds what it says (ADR 0106, laws 4, 5 and 6): a kind that
 * ends each act and leaves the pill to the Frame passes it, on arc's
 * older build too, and one that hangs on an act without words, or draws
 * arc's pill itself, does not.
 */
import { Lost, Unreachable } from "@banda/contract"
import { MessageSquareIcon } from "lucide-react"
import { type ComponentType, useEffect, useState } from "react"
import { expect, test } from "vitest"
import { definePane, type PaneProps } from "../pane"
import { AWAY, conformance } from "./conformance"

type None = { [key: string]: never }

/** Sends a command, which ends at once while arc is away, and says what
 * became of it: sent, not sent and why, as "Not sent: arc is away", which
 * is no pill, or that it may have gone. */
function Sends({ engine, project }: PaneProps<None>) {
  const [said, say] = useState("")
  const send = () =>
    engine.command("projects.create", { name: "Kit" } as never, project).then(
      () => say("Sent"),
      (error: Error) =>
        say(
          error instanceof Unreachable && error.may_have_run
            ? "It may have gone"
            : `Not sent: ${error.message}`
        )
    )
  return (
    <div>
      <button type="button" onClick={() => void send()}>
        Send
      </button>
      <p>{said}</p>
    </div>
  )
}

/** Reads the Projects before it acts, as Commit reads first, and says
 * nothing meanwhile: the read waits while arc is away, so the click
 * would complete later by itself. */
function Checks({ engine }: PaneProps<None>) {
  const [said, say] = useState("")
  const check = () =>
    engine.call("projects.list", null as never).then(
      () => say("Checked"),
      () => say("Not checked")
    )
  return (
    <div>
      <button type="button" onClick={() => void check()}>
        Check
      </button>
      <p>{said}</p>
    </div>
  )
}

/** Checks as `Checks` does, under a top that names arc all along, as New
 * Pane's "in banda on arc" does: that says nothing of the read. */
function Headed(props: PaneProps<None>) {
  return (
    <div>
      <h1>in banda on arc</h1>
      <Checks {...props} />
    </div>
  )
}

/** Checks as `Checks` does, and says while the read waits that it waits
 * for arc, as "send when back" does. */
function Waits({ engine }: PaneProps<None>) {
  const [said, say] = useState("")
  const check = () => {
    say("Checks once arc is back")
    return engine.call("projects.list", null as never).then(
      () => say("Checked"),
      () => say("Not checked")
    )
  }
  return (
    <div>
      <button type="button" onClick={() => void check()}>
        Check
      </button>
      <p>{said}</p>
    </div>
  )
}

/** Reads again what the link lost on its way: once arc is away the read
 * waits, so the click would complete later by itself, the one in flight
 * as arc went too. */
function Retries({ engine }: PaneProps<None>) {
  const [said, say] = useState("")
  const check = (): Promise<void> =>
    engine.call("projects.list", null as never).then(
      () => say("Checked"),
      (error: Error) => (error instanceof Lost ? check() : say("Not checked"))
    )
  return (
    <div>
      <button type="button" onClick={() => void check()}>
        Check
      </button>
      <p>{said}</p>
    </div>
  )
}

/** Sends as `Sends` does, and says arc is away itself, a second pill. */
function Tells(props: PaneProps<None>) {
  const [away, setAway] = useState(false)
  useEffect(() => {
    const stop = props.engine.watch((status) =>
      setAway(status.state === "away")
    )
    return () => void stop()
  }, [props.engine])
  return (
    <div>
      {away && <p>{AWAY}</p>}
      <Sends {...props} />
    </div>
  )
}

/** Lists the Projects as it mounts, and drops what refuses it: on a
 * build of arc without the method the Pane stays empty, and says
 * nothing. */
function Lists({ engine }: PaneProps<None>) {
  const [listed, list] = useState(0)
  useEffect(() => {
    void engine
      .call("projects.list", null as never)
      .then((projects) => list(projects.length))
  }, [engine])
  return <p>{listed} Projects</p>
}

/** Draws a button only once arc answers, and reads again on Refresh with
 * no words of its own, as a Pane's reads may: its pill is the Frame's. */
function Reads({ engine }: PaneProps<None>) {
  const [listed, list] = useState<number>()
  const read = () =>
    engine.call("projects.list", null as never).then(
      (projects) => list(projects.length),
      () => undefined
    )
  useEffect(() => void read(), [engine])
  return listed === undefined ? (
    <p>Reading</p>
  ) : (
    <div>
      <button type="button" onClick={() => void read()}>
        Refresh
      </button>
      <button type="button" onClick={() => list(0)}>
        Clear
      </button>
    </div>
  )
}

/** A kind of the kit's own that opens on another machine. */
const kind = (id: string, Pane: ComponentType<PaneProps<None>>) =>
  definePane<None>({
    kind: id,
    name: "Probe",
    title: () => id,
    icon: MessageSquareIcon,
    elsewhere: true,
    Pane,
  })

test("a kind whose acts end, and that leaves the pill to the Frame, conforms", async () => {
  expect(await conformance({ kind: kind("kit.sends", Sends) })).toEqual([])
})

test("a kind that hangs on an act without words does not, and the kit says where", async () => {
  expect(await conformance({ kind: kind("kit.checks", Checks) })).toEqual([
    "kit.checks, away before an act, Check: projects.list still waits, and nothing says why",
  ])
})

test("a kind that names arc all along does not say so why an act waits", async () => {
  expect(await conformance({ kind: kind("kit.headed", Headed) })).toEqual([
    "kit.headed, away before an act, Check: projects.list still waits, and nothing says why",
  ])
})

test("a kind that says an act waits for arc may let it wait", async () => {
  expect(await conformance({ kind: kind("kit.waits", Waits) })).toEqual([])
})

test("a kind that asks again what was in flight as arc went hangs too", async () => {
  expect(await conformance({ kind: kind("kit.retries", Retries) })).toEqual([
    "kit.retries, away before an act, Check: projects.list still waits, and nothing says why",
    "kit.retries, away with an act in flight, Check: projects.list still waits, and nothing says why",
  ])
})

test("a kind that draws its machine's pill itself draws a second", async () => {
  expect(await conformance({ kind: kind("kit.tells", Tells) })).toEqual([
    "kit.tells, away before an act, Send: says arc is away itself; the one pill is the Frame's",
    "kit.tells, away with an act in flight, Send: says arc is away itself; the one pill is the Frame's",
  ])
})

test("a kind that drops what an older build of arc refuses says nothing, and the kit says where", async () => {
  expect(
    await conformance({
      kind: kind("kit.lists", Lists),
      answers: (method) => (method === "projects.list" ? [] : null),
      // It has nothing to click: it is only looked at.
      gestures: {},
    })
  ).toEqual([
    'kit.lists, arc lacks the method, as it mounts: leaves "There is no method "projects.list"." unhandled',
  ])
})

test("a button that only reads may wait as the Frame's pill says why, and one an older build gave no reason to draw is no fault", async () => {
  const read = {
    kind: kind("kit.reads", Reads),
    answers: (method: string) => (method === "projects.list" ? [] : null),
  }
  expect(await conformance({ ...read, reads: ["Refresh"] })).toEqual([])
  // Played as an act, its read waiting is the kit's finding.
  expect(await conformance(read)).toEqual([
    "kit.reads, away before an act, Refresh: projects.list still waits, and nothing says why",
  ])
})

test("a kind with nothing to click is not passed for doing nothing", async () => {
  expect(
    await conformance({
      kind: kind("kit.lists", Lists),
      answers: (method) => (method === "projects.list" ? [] : null),
    })
  ).toContain(
    "kit.lists: draws no button, so the kit made no gesture in it; give it the Person's gestures, or none"
  )
})
