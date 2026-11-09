/**
 * What a Person does with one Thread, apart from how its Pane shows it:
 * the live Thread, its Harness and settings, and each command a Person
 * sends to it — a message, Implement, an answer, stop, retry and the
 * queue's. The Thread Pane lays these out; it decides none of them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { newId, type Engine, type ProjectId } from "@banda/contract"
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
import { useMachine } from "@banda/ui/hooks/use-status"
import { projectsChanged } from "@banda/ui/lib/projects"
import { keepZoom, zoomOf } from "@banda/ui/lib/zoom"
import { useAct } from "@banda/ui/hooks/use-act"
import { useInFront } from "@banda/ui/hooks/use-in-front"
import { READ_AGAIN, type Source, useLive } from "@banda/ui/hooks/use-live"
import type { PaneProps } from "@banda/ui/pane"
import { type Attaching, useAttachments } from "../composer/Attachments"
import type { Values } from "../asking/form"
import type { HarnessView } from "@banda/contract/harnesses"
import { harnessName, harnessShort, useHarnesses } from "../harnesses"
import { useStartsOn } from "./starts-on"
import { useThread } from "./live-thread"
import { settledTurn } from "../list/marks"
import { useImageReader } from "../entries/parts/MessageImages"
import { base64Of, dataUrl } from "../composer/images"
import type { QueueActions } from "./Queue"
import { mark } from "../list/sent"
import { type WhenPresent, whenPresent } from "./presence"
import {
  asked,
  declineOnce,
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
  /** The other host of `hosts.toml` whose Project it is in, by its name
   * (`paneHost`, ADR 0081): the window gives the Pane that host's
   * engine, and what reaches this machine's files stays off. */
  host?: string
}

/** A Thread not yet started, on this computer's first Harness. */
export const NEW_THREAD: ThreadArgs = { thread: null, harness: "", title: "" }

/** What a Thread's text size is kept under (ADR 0063, decision 5): a
 * Thread not yet made has one for all. */
export const zoomKey = (thread: string | null) => `thread ${thread ?? "new"}`

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
 * One not sent, as its host was away, is armed again once the host is
 * back, and goes as the first would have, when the Person is there: the
 * Thread on screen does not stay Done everywhere for a host that came
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
  let off = false
  // What calls off the wait now: for the Person, or for the host.
  let stop = () => {}
  const see = () =>
    void mark(engine, project, thread, { seen: turn }, { quiet: true }).then(
      (took) => {
        // A refusal comes while the host is there; only a seen not sent
        // waits for it to come back.
        if (took || off || engine.status.state === "open") return
        stop = whenOpen(engine, () => (stop = when(see)))
      }
    )
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
  const startsOn = useStartsOn(engine)
  const harness =
    thread === null
      ? args.harness || startsOn?.id || offered[0]?.id || ""
      : (state?.harness ?? args.harness)
  const name = harnessName(harnesses, harness) || "the Agent"
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
  // window. The mark goes to the Thread's host, this Pane's engine.
  const front = useInFront()
  const settled = state && settledTurn(state.turns)
  useEffect(() => {
    if (!focused || !front || thread === null || !settled) return
    return seeWhenPresent(engine, project, thread, settled)
  }, [focused, front, thread, settled, engine, project])

  // A Thread not yet started keeps its settings here until its first
  // message, starting from its Harness's; each Harness's, as the model
  // picker chooses the Harness with the model (ADR 0031, decision 6).
  const everyDefaults = useHarnessDefaults(
    engine,
    project,
    thread === null && machine && !unplaced ? offered : null
  )
  const defaults = everyDefaults?.[harness]
  const [drafts, setDrafts] = useState<Record<string, Settings>>({})
  const draftOf = (id: string) =>
    drafts[id] ??
    everyDefaults?.[id]?.settings ??
    (unplaced ? DEFAULT_SETTINGS : undefined)
  const settings = thread === null ? draftOf(harness) : state?.settings
  const offer: Offer =
    (thread === null ? defaults?.offer : state?.offer) ?? NO_OFFER
  const configure = async (next: Settings): Promise<boolean> => {
    if (thread === null) {
      setDrafts((drafts) => ({ ...drafts, [harness]: next }))
      return true
    }
    return (
      (await acting.act(async () => {
        await engine.command(
          "agents.configure",
          { thread, settings: next },
          project
        )
        return true
      })) === true
    )
  }

  const images = useAttachments({
    thread,
    attach: async (image: Attaching) =>
      engine.command("agents.attach", image, await ensureProject()),
    reader,
    closed: offer.no_images ? `${name} does not take images.` : undefined,
  })
  // A file dropped or pasted, kept in the Project for the message to name.
  const keep = (file: File) =>
    acting.act(async () => {
      const target = await ensureProject()
      const data = base64Of(await dataUrl(file))
      const kept = await engine.command(
        "agents.keep",
        { name: file.name, data },
        target
      )
      return kept.path
    })
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
  // and a message sent while any waits says no to it first, as in T3 Code.
  const asking = state && asked(state)
  // A plan the Agent proposed waits for Implement, or for a message that
  // refines it.
  const planned = state && proposedPlan(state)

  const answer = (item: ItemId, choice: string, values?: Values) =>
    acting.act(() =>
      engine.command(
        "agents.answer",
        { item, choice, ...(values && { values }) },
        project
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
  /** Sends `text`; an existing Thread changes to `next` first, if given. */
  const go = async (
    text: string,
    images: Image[],
    steer: boolean,
    next?: Settings
  ) => {
    const no = asking && declineOnce(asking.body)
    if (no && text && (await answer(asking.id, no)) === undefined) return false
    let target = project
    const sent = await sending.act(async () => {
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
  // first, so they go once.
  useEffect(() => {
    if (thread !== null || !args.ask || (!defaults && !unplaced)) return
    const { ask, ...rest } = args
    update(rest)
    void go(ask, [], false)
  })
  // Implement turns plan mode off and asks for the plan, in one command.
  const implement = () => {
    if (settings) void go(IMPLEMENT, [], false, { ...settings, plan: false })
  }
  // A turn's changes open in the git module's Diff, on that Turn: in the
  // Diff already open, or beside the Thread (ADR 0034).
  const openDiff = (turn: string, path?: string) => {
    if (thread === null) return
    // Its title comes from the engine, which names the turn. It goes into
    // the Thread's Group (ADR 0065, decision 7).
    open(
      {
        kind: "git.diff",
        args: {
          scope: { kind: "turn", thread, turn, title: "" },
          file: path ?? null,
        },
      },
      "group"
    )
  }
  const stop = (turn: TurnView) =>
    void acting.act(() =>
      engine.command("agents.stop", { turn: turn.id }, project)
    )
  const retry = (turn: TurnView) =>
    void acting.act(() =>
      engine.command("agents.retry", { turn: turn.id }, project)
    )
  const retryOn = (turn: TurnView, harness: string) =>
    void acting.act(async () => {
      if (thread === null) return
      await engine.command("agents.switch", { thread, harness }, project)
      await engine.command("agents.retry", { turn: turn.id }, project)
    })
  // The fork opens here, as a Thread picked in the sidebar does.
  const fork = (turn: TurnView) =>
    void acting
      .act(() => engine.command("agents.fork", { turn: turn.id }, project))
      .then((forked) => forked && update({ ...forked, harness }))
  const queue: QueueActions = {
    onSendNow: ({ turn }) =>
      void acting.act(() =>
        engine.command("agents.steer", { turn: turn.id }, project)
      ),
    onEdit: async ({ turn }, text) =>
      (await acting.act(() =>
        engine.command("agents.edit", { turn: turn.id, text }, project)
      )) !== undefined,
    onRemove: ({ turn }) =>
      void acting.act(() =>
        engine.command("agents.withdraw", { turn: turn.id }, project)
      ),
    editing,
    onEditing: setEditing,
    onContinue: () => {
      if (thread === null) return
      void acting.act(() =>
        engine.command("agents.resume", { thread }, project)
      )
    },
  }

  return {
    live,
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
    settings,
    offer,
    configure,
    /** A new Thread's Harnesses, each with what it would start with, for
     * the model picker to choose one by its model; none once it started. */
    starts:
      thread === null && (everyDefaults || unplaced)
        ? offered.flatMap(({ id, name }) => {
            const settings = draftOf(id)
            const offer =
              everyDefaults?.[id]?.offer ?? (unplaced ? NO_OFFER : undefined)
            return settings && offer ? [{ id, name, settings, offer }] : []
          })
        : undefined,
    /** Starts the new Thread on `next` instead, with `settings`. */
    startOn: (next: string, settings?: Settings) => {
      if (settings) setDrafts((drafts) => ({ ...drafts, [next]: settings }))
      update({ ...args, harness: next })
    },
    /** Whether the Thread plans first, when its Harness offers plans. */
    plan: offer.plans ? settings?.plan : undefined,
    setPlan: (plan: boolean) => settings && configure({ ...settings, plan }),
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
    send: (text: string, images: Image[], steer: boolean) =>
      go(text, images, steer),
    implement,
    answer,
    openDiff,
    stop,
    retry,
    retryOn,
    /** Forks the Thread at the end of `turn` and opens the fork. */
    fork,
    /** Takes the Thread back to before `turn`'s message; resolves
     * whether it went. */
    rewind: async (turn: TurnView) =>
      (await acting.act(() =>
        engine.command("agents.rewind", { turn: turn.id }, project)
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
 * fence allows, or agents.toml's, and what the Harness last offered,
 * such as its models.
 */
function useHarnessDefaults(
  engine: Engine,
  project: ProjectId,
  offered: HarnessView[] | null
): Record<string, Defaults> | undefined {
  type Every = { at: number; each: Record<string, Defaults> }
  const source = useMemo<Source<Every> | null>(() => {
    const harnesses = offered?.map((h) => h.id) ?? []
    return harnesses.length === 0
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
  }, [engine, project, offered])
  const live = useLive(engine, project, source)
  return live.state === "ready" ? live.view.each : undefined
}
