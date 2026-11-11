/**
 * What a Person does with one Thread, apart from how its Pane shows it:
 * the live Thread, its Harness and settings, and each command a Person
 * sends to it — a message, Implement, an answer, stop, retry and the
 * queue's. The Thread Pane lays these out; it decides none of them. Each
 * that does not go says why: on the Thread's problem line, or, for a
 * machine the window does not reach, at once in a toast that names it.
 * Only a message waits for that machine, as the Person sends it when back
 * (ADR 0105).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { newId, type Engine, type ProjectId } from "@banda/contract"
import {
  KEEP,
  Unreachable,
  useQueue,
  usePlaced,
  useWaiting,
  type Wait,
  waitsFor,
} from "@banda/core/react"
import { toast } from "@banda/ui/components/sonner"
import { problem } from "@banda/ui/lib/words"
import type {
  Defaults,
  Image,
  ItemId,
  Offer,
  Settings,
  ThreadId,
  TurnId,
  TurnView,
} from "@banda/contract/agents"
import { useMachine, useSeenNamed, useStatus } from "@banda/ui/hooks/use-status"
import { projectsChanged } from "@banda/ui/lib/projects"
import { keepZoom, zoomOf } from "@banda/ui/lib/zoom"
import { useAct } from "@banda/ui/hooks/use-act"
import { useInFront } from "@banda/ui/hooks/use-in-front"
import { READ_AGAIN, type Source, useLive } from "@banda/ui/hooks/use-live"
import type { PaneProps, PaneState } from "@banda/ui/pane"
import { type Attaching, useAttachments } from "../composer/Attachments"
import type { Values } from "../asking/form"
import type { HarnessView } from "@banda/contract/harnesses"
import {
  byHarness,
  harnessName,
  harnessShort,
  useHarnesses,
} from "../harnesses"
import { useAgentsTold, useStartsOn } from "./starts-on"
import { useThread } from "./live-thread"
import { settledTurn } from "../list/marks"
import { useImageReader } from "../entries/parts/MessageImages"
import { base64Of, dataUrl } from "../composer/images"
import type { QueueActions } from "./Queue"
import { mark, type PersonMark } from "../list/sent"
import { type WhenPresent, whenPresent } from "./presence"
import { useLooking } from "./looking"
import { imagesOf, tellBack, whenBackTitle } from "./WhenBack"
import { putBack, useDraftKey } from "../composer/drafts"
import {
  asked,
  declined,
  NO_OFFER,
  DEFAULT_SETTINGS,
  proposedPlan,
  sent,
  steerable,
  waiting,
  working,
} from "./state"

/**
 * One Thread: a session with a Harness in a Project (ADR 0006). Without
 * `thread`, the next message starts one on `harness`, or on this computer's
 * first Harness when it names none. `title` keeps the header's words while
 * the Thread loads. An Agent opens one by `thread` alone (`AGENT_KINDS` in
 * the workspaces engine): the rest are the Person's.
 */
export type ThreadArgs = {
  thread: ThreadId | null
  harness: string
  title: string
  /** The first message, sent as the Pane opens: the Banda menu's words. */
  ask?: string
  /** The Person hid the Thread's details card (ADR 0034, decision 4). */
  details?: false
  /** The folder created by the draft’s first message or attachment. */
  scratch?: ProjectId
  /** Kept with the draft so creation can be replayed after a reload. */
  scratchCommand?: string
  /** The other host of `hosts.toml` whose Project it is in, by its name,
   * as the window's directory says it and hands it to the Pane (ADR
   * 0106, decision 1), never kept in the arrangement: the window gives
   * the Pane that host's engine, and what reaches this machine's files
   * stays off, until the Thread's slices take this away. */
  host?: string
  /** A new Thread's draft's key, kept once something is written in it, so
   * the draft is there after a restart (#838). */
  draft?: string
}

/** A Thread not yet started, on this computer's first Harness. */
export const NEW_THREAD: ThreadArgs = { thread: null, harness: "", title: "" }

/** What a Thread's text size is kept under (ADR 0063, decision 5): a
 * Thread not yet made has one for all. */
export const zoomKey = (thread: string | null) => `thread ${thread ?? "new"}`

/** The git module's Diff on `turn` of `thread`, on `path` in it, if one:
 * its title comes from the engine, which names the turn. */
export function turnDiffPane(
  thread: ThreadId,
  turn: string,
  path?: string
): PaneState {
  return {
    kind: "git.diff",
    args: {
      scope: { kind: "turn", thread, turn, title: "" },
      file: path ?? null,
    },
  }
}

/** What Implement asks the Agent, once plan mode is off. */
const IMPLEMENT = "Implement the plan."

/**
 * Marks `turn` of `thread` seen once its Person is at the window, as
 * `when` tells: an input within the last minute, or the first after (ADR
 * 0096, decision 3). Gives back how to call that off.
 *
 * The mark goes to the Thread's host, `engine`, which every window and
 * machine reads, and shows at once (`mark`). It is sent only while that
 * host is there: one sent while it is away would land once it is back,
 * maybe after the Person marked the Thread unread on another machine
 * (decision 8). It fails quietly, as an older host's refusal: the window
 * marked it by itself.
 *
 * One not sent, or lost on its way, as its host was away, is armed again
 * once the host is back, and goes as a new seen when the Person is there:
 * the Thread on screen does not stay Done everywhere for a host that came
 * back. One the host took, or refused while it was there, is done, so a
 * "Mark as unread" made since stays (ADR 0077, decision 6).
 */
export function seeWhenPresent(
  engine: Engine,
  project: ProjectId,
  thread: ThreadId,
  turn: TurnId,
  when: WhenPresent = whenPresent
): () => void {
  return markWhenPresent(engine, project, thread, { seen: turn }, when)
}

/**
 * Sends `seen`, a mark the window gives by itself as its Person looks at
 * the Thread, once they are at the window, as `seeWhenPresent` sends a
 * turn seen: quietly, and again once a host that was away is back. Gives
 * back how to call that off.
 */
export function markWhenPresent(
  engine: Engine,
  project: ProjectId,
  thread: ThreadId,
  seen: PersonMark,
  when: WhenPresent = whenPresent
): () => void {
  let off = false
  // What calls off the wait now: for the Person, or for the host.
  let stop = () => {}
  const see = () => {
    // A wait for the Person armed as the host came back, and not called
    // off with the rest, sends nothing for a Thread no longer on screen.
    if (off) return
    void mark(engine, project, thread, seen, { quiet: true }).then((took) => {
      // A refusal comes while the host is there; only a seen not sent,
      // or lost on its way, waits for it to come back.
      if (took || off || engine.status.state === "open") return
      stop = whenOpen(engine, () => (stop = when(see)))
    })
  }
  stop = when(see)
  return () => {
    off = true
    stop()
  }
}

/** Runs `act` once, when `engine` is next open; gives back how to call
 * that off. */
function whenOpen(engine: Engine, act: () => void): () => void {
  let waiting = true
  let stop: (() => void) | undefined = undefined
  stop = engine.watch((status) => {
    if (!waiting || status.state !== "open") return
    waiting = false
    stop?.()
    act()
  })
  // `watch` tells the status at once: an engine open already.
  if (!waiting) stop()
  return () => {
    waiting = false
    stop?.()
  }
}

/**
 * `run`, an act named `what`, as its button says it ("Stop") or as the
 * Person would ("your answer"), for `useAct`: on a machine the window does
 * not reach (`Unreachable`) it says so at once in a toast that names that
 * machine, and the act did not go; anything else goes on to the Thread's
 * problem line (ADR 0082, decision 16).
 */
export function named<T>(
  what: string,
  run: () => Promise<T>
): () => Promise<T | undefined> {
  return () =>
    run().catch((error: unknown) => {
      if (!(error instanceof Unreachable)) throw error
      toast.error(problem(error, what))
      return undefined
    })
}

/** The Thread a Pane with `args` shows, and what its Person may do there. */
export function useThreadSession({
  engine,
  project,
  args,
  focused,
  open,
  update,
}: PaneProps<ThreadArgs>) {
  const { thread } = args
  // Where the composer keeps its draft: a new Thread's under a key its
  // args keep once something is written, as there after a restart (#838).
  const draft = useDraftKey(thread, args.draft, (id) =>
    update({ ...args, draft: id })
  )
  const machine = useMachine(engine)
  const unplaced = project === machine && !args.scratch
  const creation = useRef(args.scratchCommand ?? newId())
  useEffect(() => {
    if (unplaced && !args.scratchCommand)
      update({ ...args, scratchCommand: creation.current })
  }, [unplaced, args, update])
  const pending = useRef<Promise<ProjectId> | null>(null)
  const ensureProject = (): Promise<ProjectId> => {
    if (!unplaced) return Promise.resolve(project)
    if (!pending.current)
      pending.current = engine
        .command(
          "projects.create",
          { scratch: true },
          undefined,
          creation.current
        )
        .then((made) => {
          update({
            ...args,
            ask: undefined,
            scratchCommand: creation.current,
            scratch: made.id,
          })
          projectsChanged()
          return made.id
        })
        .catch((error: unknown) => {
          pending.current = null
          throw error
        })
    return pending.current
  }
  const live = useThread(engine, project, thread)
  const state = live.state === "ready" ? live.view : undefined
  const sending = useAct()
  const acting = useAct()
  const reader = useImageReader(engine, project)
  const harnesses = useHarnesses(engine)
  // A new Thread starts on a Harness that is on: the one the Person put
  // it on, else the default, or the fallback while the default is out
  // (ADR 0093, decision 7).
  const offered = useMemo(() => harnesses.filter((h) => h.enabled), [harnesses])
  // Where it starts is its machine's to say, through that machine's
  // engine (ADR 0106, step 5a; ADR 0108, decision 4); its model and mode
  // follow that machine's agents.toml.
  const told = useAgentsTold(engine, thread === null)
  // A Thread not yet started keeps its settings here until its first
  // message, starting from its Harness's; each Harness's, as the model
  // picker chooses the Harness with the model (ADR 0031, decision 6).
  const everyDefaults = useHarnessDefaults(
    engine,
    project,
    thread === null && machine && !unplaced ? offered : null,
    told.count
  )
  const startsOn = useStartsOn(engine)
  const harness =
    thread === null
      ? args.harness || startsOn?.id || ""
      : (state?.harness ?? args.harness)
  // The messages that wait for the Thread's machine (ADR 0105), which
  // keep what the Pane shows before that machine answers, as after a
  // restart while it is away: its Harness's name (Q6, #956) and skills.
  // The machine is the one the directory says has its Project, by its
  // hosts.toml name, as the queue keeps it (ADR 0106, decision 1).
  const { host, shown } = usePlaced(project, args.host)
  const waitsHere = useWaiting(host, thread)
  const shows = waitsHere.find((wait) => wait.shows)?.shows
  const name = harnessName(harnesses, harness, shows?.to) || "the Agent"
  const short = harnessShort(harnesses, harness) || name

  // The header follows the Thread: its title, once the first message gives
  // it one, and its Harness come back with the Pane.
  useEffect(() => {
    if (
      thread !== null &&
      state &&
      (state.title !== args.title || state.harness !== args.harness)
    )
      update({ thread, harness: state.harness, title: state.title })
  }, [thread, state, args.title, args.harness, update])

  // A Person who looks at the Thread, its Pane focused in the window in
  // front, sees how its latest turn ended, which settles its mark in the
  // sidebar and the bar (ADR 0011, decision 1), once they are at the
  // window. A focus that only passes by settles nothing (ADR 0096,
  // decision 3). The mark goes to the Thread's host, this Pane's engine.
  const front = useInFront()
  const { looking, acted } = useLooking(focused)
  const settled = state && settledTurn(state.turns)
  useEffect(() => {
    if (!looking || !front || thread === null || !settled) return
    return seeWhenPresent(engine, project, thread, settled)
  }, [looking, front, thread, settled, engine, project])

  const defaults = everyDefaults?.[harness]
  const [drafts, setDrafts] = useState<Record<string, Settings>>({})
  const draftOf = (id: string) =>
    drafts[id] ??
    everyDefaults?.[id]?.settings ??
    (unplaced ? DEFAULT_SETTINGS : undefined)
  const settings = thread === null ? draftOf(harness) : state?.settings
  // Before its machine answers, the skills a waiting message kept, by
  // name: its composer offers them as it did (Q6).
  const skills = shows?.skills
  const offerKept = useMemo(
    () =>
      skills && {
        ...NO_OFFER,
        skills: skills.map((name) => ({ name, description: "" })),
      },
    [skills]
  )
  const offer: Offer =
    (thread === null ? defaults?.offer : (state?.offer ?? offerKept)) ??
    NO_OFFER
  const configure = async (next: Settings): Promise<boolean> => {
    if (thread === null) {
      setDrafts((drafts) => ({ ...drafts, [harness]: next }))
      return true
    }
    return (
      (await acting.act(
        named("the change", async () => {
          await engine.command(
            "agents.configure",
            { thread, settings: next },
            project
          )
          return true
        })
      )) === true
    )
  }

  const images = useAttachments({
    thread: draft,
    attach: async (image: Attaching) =>
      engine.command("agents.attach", image, await ensureProject()),
    reader,
    closed: offer.no_images ? `${name} does not take images.` : undefined,
  })
  // A file dropped or pasted, kept in the Project for the message to name.
  const keep = (file: File) =>
    acting.act(
      named("the file", async () => {
        const target = await ensureProject()
        const data = base64Of(await dataUrl(file))
        const kept = await engine.command(
          "agents.keep",
          { name: file.name, data },
          target
        )
        return kept.path
      })
    )
  // The files `@` names come from the Project's folder, as the files
  // module finds them (ADR 0073, decision 11).
  const findFiles = useCallback(
    (query: string) =>
      unplaced
        ? Promise.resolve([])
        : engine
            .call("files.find", { query }, { project })
            .then((found) => found.paths),
    [engine, project, unplaced]
  )

  // The waiting message open to edit, from its Edit or ↑ in the composer.
  const [editing, setEditing] = useState<ItemId>()
  const waits = state ? waiting(state) : []
  const last = waits.at(-1)
  // The Question the Agent waits on: one with a form opens on the composer,
  // and a message sent while the Agent's own waits says no to it first, as
  // in T3 Code; a sub-agent's stays open (ADR 0103, decision 28).
  const asking = state && asked(state)
  // A plan the Agent proposed waits for Implement, or for a message that
  // refines it.
  const planned = state && proposedPlan(state)

  const answer = (item: ItemId, choice: string, values?: Values) =>
    acting.act(
      named("your answer", () =>
        engine.command(
          "agents.answer",
          { item, choice, ...(values && { values }) },
          project
        )
      )
    )
  // A No Space draft shows no mode, so its Person chose none: what they
  // chose of the rest goes with the mode the engine gives a new Thread in
  // its new Project, which follows the fence (ADR 0083). With nothing
  // chosen, the engine decides it all.
  const drafted = async (target: ProjectId): Promise<Settings | null> => {
    const draft = drafts[harness]
    if (!draft) return null
    const engines = await engine.call(
      "agents.defaults",
      { harness },
      { project: target }
    )
    return { ...draft, mode: engines.settings.mode }
  }
  /** Sends `text`, as the act `what` names; an existing Thread changes to
   * `next` first, if given. */
  const go = async (
    text: string,
    images: Image[],
    steer: boolean,
    next?: Settings,
    what = "your message"
  ) => {
    const no = state && declined(state)
    if (no && text && (await answer(no.item, no.choice)) === undefined)
      return false
    let target = project
    const sent = await sending.act(
      named(what, async () => {
        target = await ensureProject()
        return engine.command(
          "agents.send",
          // A new Thread starts as its composer shows; an existing one runs
          // with its own settings, which the bar changes as it goes.
          {
            ...(thread === null ? { harness } : { thread }),
            text,
            images: images.map(({ id }) => id),
            settings:
              thread === null
                ? unplaced
                  ? await drafted(target)
                  : (settings ?? null)
                : (next ?? null),
            steer,
          },
          target
        )
      })
    )
    if (sent && thread === null) {
      // Its words keep the size they were given before it was made.
      keepZoom(zoomKey(sent.thread), zoomOf(zoomKey(null)))
      keepZoom(zoomKey(null), 1)
      const next = { thread: sent.thread, harness, title: args.title }
      if (target !== project || args.scratch)
        open({ kind: "agents.thread", args: next }, "instead", target)
      else update(next)
    }
    return sent !== undefined
  }
  // Words from the Banda menu start the Thread as the Pane opens, with its
  // Harness's settings (ADR 0017, decision 6). They leave the Pane's args
  // first, so they go once. With its machine out of reach they go at
  // once, to be refused, never to start a Thread by themselves once it is
  // back (ADR 0082, decision 16); words that did not go wait in the
  // composer. So do they while its engine answers nothing: the Pane is
  // drawn again as its machine shows away.
  const { state: reach } = useStatus(engine)
  const out = reach === "away" || reach === "refused" || engine.stale
  const [unsent, setUnsent] = useState<{ text: string }>()
  const took = useRef<string>(undefined)
  useEffect(() => {
    if (thread !== null || !args.ask) return
    if ((unplaced ? !startsOn : !defaults) && !out) return
    const { ask, ...rest } = args
    update(rest)
    // Once, though the Pane is drawn again before its args lose them.
    if (took.current === ask) return
    took.current = ask
    void go(ask, [], false).then((went) => went || setUnsent({ text: ask }))
  })

  // While a started Thread's machine is away, stopped or on another
  // build, a message waits for it, by Send itself (ADR 0105, Q2), for 10
  // minutes from now, unless the Person keeps it longer. A new Thread's
  // first words stay in its composer. It keeps what its Pane shows before
  // that machine answers: its Project, its title and its Harness's name
  // (Q6).
  const queued = useQueue()
  const later = thread !== null && waitsFor(shown, reach)
  const on = useSeenNamed(host)?.name
  const whenBack =
    later && on !== undefined
      ? (now: number) => whenBackTitle(on, now + KEEP, now)
      : undefined
  const sendWhenBack = (text: string, images: Image[]) => {
    if (thread === null || host === undefined) return false
    const summary =
      shown?.projects.find((one) => one.id === project) ??
      queued.get().find((one) => one.project === project && one.shows?.project)
        ?.shows?.project
    queued.add({
      call: {
        method: "agents.send",
        params: {
          thread,
          text,
          images: images.map(({ id }) => id),
          settings: null,
          steer: false,
        },
        // Fixed now: each send of it is this one command.
        command: newId(),
      },
      host,
      project,
      item: thread,
      text,
      // To show, and to put back with its words.
      carried: images,
      pane: {
        kind: "agents.thread",
        args: { thread, harness, title: state?.title ?? args.title },
      },
      shows: {
        ...(summary && { project: summary }),
        to: name,
        ...(offer.skills.length > 0 && {
          skills: offer.skills.map((skill) => skill.name),
        }),
      },
      at: Date.now(),
    })
    return true
  }
  // What comes back to this Thread that no Window takes, as in a window
  // of its own, goes back into its draft here, and is said here where
  // only this window shows the Thread.
  useEffect(
    () =>
      thread === null || host === undefined
        ? undefined
        : queued.onBack(
            (back) => back.wait.host === host && (tellBack(back), true),
            { item: thread }
          ),
    [queued, host, thread]
  )
  const whenBackActions = {
    /** Takes it back, its words and images into the draft. */
    onCancel: (wait: Wait) => {
      if (queued.cancel(wait.call.command))
        putBack(wait.item, wait.text, imagesOf(wait))
    },
    /** Changes its words, by the same command and in its time; one that
     * went meanwhile leaves the words typed in the draft. */
    onEdit: (wait: Wait, text: string) => {
      const { call } = wait
      if (call.method !== "agents.send") return
      const changed = queued.edit(call.command, text, {
        ...call,
        params: { ...call.params, text },
      })
      if (!changed) putBack(wait.item, text)
    },
    /** Holds it while its row is edited. */
    onHold: (wait: Wait) => queued.hold(wait.call.command),
    /** Keeps it for `keep` ms from when Send was pressed. */
    onKeepFor: (wait: Wait, keep: number) =>
      queued.keepFor(wait.call.command, keep),
  }
  // Implement turns plan mode off and asks for the plan, in one command.
  const implement = () => {
    if (settings)
      void go(IMPLEMENT, [], false, { ...settings, plan: false }, "Implement")
  }
  // A turn's changes open in the git module's Diff, on that Turn: in the
  // Diff already open, or beside the Thread, in its Group (ADR 0034; ADR
  // 0065, decision 7).
  const openDiff = (turn: string, path?: string) => {
    if (thread !== null) open(turnDiffPane(thread, turn, path), "group")
  }
  const stop = (turn: TurnView) =>
    void acting.act(
      named("Stop", () =>
        engine.command("agents.stop", { turn: turn.id }, project)
      )
    )
  const retry = (turn: TurnView) =>
    void acting.act(
      named("Try again", () =>
        engine.command("agents.retry", { turn: turn.id }, project)
      )
    )
  // To another account or Harness from its next turn (ADR 0078).
  const moveTo = (harness: string) =>
    void acting.act(async () => {
      if (thread === null) return
      await engine.command("agents.switch", { thread, harness }, project)
    })
  // Wakes, moves and sends again in one command (ADR 0078, decision 6).
  const retryOn = (turn: TurnView, harness: string) =>
    void acting.act(
      named(`Go on with ${harnessName(harnesses, harness)}`, () =>
        engine.command("agents.go_on", { turn: turn.id, harness }, project)
      )
    )
  // The fork opens here, as a Thread picked in the sidebar does.
  const fork = (turn: TurnView) =>
    void acting
      .act(
        named("Fork", () =>
          engine.command("agents.fork", { turn: turn.id }, project)
        )
      )
      .then((forked) => forked && update({ ...forked, harness }))
  const queue: QueueActions = {
    onSendNow: ({ turn }) =>
      void acting.act(
        named("Send now", () =>
          engine.command("agents.steer", { turn: turn.id }, project)
        )
      ),
    onEdit: async ({ turn }, text) =>
      (await acting.act(
        named("your edit", () =>
          engine.command("agents.edit", { turn: turn.id, text }, project)
        )
      )) !== undefined,
    onRemove: ({ turn }) =>
      void acting.act(
        named("Remove", () =>
          engine.command("agents.withdraw", { turn: turn.id }, project)
        )
      ),
    editing,
    onEditing: setEditing,
    onContinue: () => {
      if (thread === null) return
      void acting.act(
        named("Continue", () =>
          engine.command("agents.resume", { thread }, project)
        )
      )
    },
  }

  return {
    live,
    /** Whether the Person looks at the Thread, not only passes it. */
    looking,
    /** For the Pane's pointer and key inputs, which count as looking. */
    acted,
    /** The Thread once it has loaded. */
    state,
    /** The turn that runs now, if one does. */
    turn: state && working(state),
    harness,
    /** The Harness's name, as the Thread speaks of its Agent. */
    name,
    /** What a sentence calls it: `Claude`. */
    short,
    reader,
    /** Whether a message is on its way. */
    sending: sending.busy,
    /** Whether any other command is. */
    acting: acting.busy,
    /** Why the last command did not go, if it did not. */
    problem: sending.problem ?? acting.problem,
    /** The Banda menu's words, once they did not go: for the composer. */
    unsent,
    settings,
    offer,
    configure,
    /** A new Thread's Harnesses, each with what it would start with, for
     * the model picker to choose one by its model; none once it started. */
    starts:
      thread === null && (everyDefaults || unplaced)
        ? byHarness(offered).flatMap(({ id, name }) => {
            const settings = draftOf(id)
            const offer =
              everyDefaults?.[id]?.offer ?? (unplaced ? NO_OFFER : undefined)
            return settings && offer ? [{ id, name, settings, offer }] : []
          })
        : undefined,
    /** A new Thread's default is out and it starts there still, no
     * fallback having room: its chip warns, and says the reset (ADR 0093,
     * decision 7). */
    startsOut:
      thread === null &&
      startsOn &&
      !startsOn.fallback &&
      harness === startsOn.default
        ? startsOn.out
        : undefined,
    /** Starts the new Thread on `next` instead, with `settings`. */
    startOn: (next: string, settings?: Settings) => {
      if (settings) setDrafts((drafts) => ({ ...drafts, [next]: settings }))
      update({ ...args, harness: next })
    },
    /** Whether the Thread plans first, when its Harness offers plans. */
    plan: offer.plans ? settings?.plan : undefined,
    setPlan: (plan: boolean) => settings && configure({ ...settings, plan }),
    /** Where the composer keeps its draft (`useDraftKey`). */
    draft,
    /** What the Person sent, for ↑ in the composer. */
    history: () => (state ? sent(state) : []),
    /** Whether a message sent now goes into the turn that runs. */
    steering: state !== undefined && steerable(state),
    images,
    findFiles,
    keep,
    waits,
    asking,
    planned,
    send: async (text: string, images: Image[], steer: boolean) =>
      whenBack === undefined
        ? go(text, images, steer)
        : sendWhenBack(text, images),
    /** Send's tooltip at `now` while a message waits for the machine, as
     * Send then does: "Sends once arc is back, until 14:42 ↵"; none while
     * it goes. */
    whenBack,
    /** The messages that wait for the machine, sent to this Thread. */
    waitsHere,
    whenBackActions,
    implement,
    answer,
    openDiff,
    stop,
    retry,
    retryOn,
    moveTo,
    /** Forks the Thread at the end of `turn` and opens the fork. */
    fork,
    /** Takes the Thread back to before `turn`'s message; resolves
     * whether it went. */
    rewind: async (turn: TurnView) =>
      (await acting.act(
        named("Edit", () =>
          engine.command("agents.rewind", { turn: turn.id }, project)
        )
      )) !== undefined,
    queue,
    /** Opens the last waiting message to edit, from ↑ in the composer. */
    editLast: last && (() => setEditing(last.item.id)),
  }
}

/** The facts that say a Harness offers something new. */
const OFFERED = { module: "agents", kinds: ["thread.offered"] }

/**
 * What a new Thread on each of `harnesses` starts with: the mode the
 * fence allows, or agents.toml's, what the Harness last offered, such as
 * its models, and the accounts its machine starts one on. Read again as
 * that machine's agents.toml is `told` to read otherwise.
 */
function useHarnessDefaults(
  engine: Engine,
  project: ProjectId,
  offered: HarnessView[] | null,
  told: number
): Record<string, Defaults> | undefined {
  type Every = { at: number; each: Record<string, Defaults> }
  // By their ids: the list read again as it was is the same source, and
  // what it read stays drawn.
  const ids = offered?.map((h) => h.id).join("\n") ?? ""
  const source = useMemo<Source<Every> | null>(() => {
    const harnesses = ids.split("\n")
    return ids === ""
      ? null
      : {
          read: async () => {
            const each = await Promise.all(
              harnesses.map((harness) =>
                engine.call("agents.defaults", { harness }, { project })
              )
            )
            return {
              // The earliest, so nothing offered since any read is missed.
              at: Math.min(...each.map((d) => d.at)),
              each: Object.fromEntries(
                harnesses.map((harness, i) => [harness, each[i]])
              ),
            }
          },
          filter: OFFERED,
          apply: () => READ_AGAIN,
        }
  }, [engine, project, ids])
  const live = useLive(engine, project, source, told)
  return live.state === "ready" ? live.view.each : undefined
}
