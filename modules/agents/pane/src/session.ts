/**
 * What a Person does with one Thread, apart from how its Pane shows it:
 * the live Thread, its Harness and settings, and each command a Person
 * sends to it — a message, Implement, an answer, stop, retry and the
 * queue's. The Thread Pane lays these out; it decides none of them.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import type {
  Defaults,
  Image,
  ItemId,
  Offer,
  Settings,
  ThreadId,
  TurnView,
} from "@banda/contract/agents"
import { useAct } from "@banda/ui/hooks/use-act"
import { useInFront } from "@banda/ui/hooks/use-in-front"
import { READ_AGAIN, type Source, useLive } from "@banda/ui/hooks/use-live"
import { paneOf, type PaneProps } from "@banda/ui/pane"
import { type Attaching, useAttachments } from "./Attachments"
import { diffPane } from "./DiffPane"
import type { Values } from "./form"
import { harnessName, useHarnesses } from "./harnesses"
import { useThread } from "./live-thread"
import { settledTurn } from "./marks"
import { useImageReader } from "./MessageImages"
import { base64Of, dataUrl } from "./images"
import type { QueueActions } from "./Queue"
import { markSeen } from "./seen"
import {
  asked,
  declineOnce,
  NO_OFFER,
  proposedPlan,
  sent,
  steerable,
  waiting,
  working,
} from "./thread"

/**
 * One Thread: a session with a Harness in a Space (ADR 0006). Without
 * `thread`, the next message starts one on `harness`, or on this computer's
 * first Harness when it names none. `title` keeps the header's words while
 * the Thread loads.
 */
export type ThreadArgs = {
  thread: ThreadId | null
  harness: string
  title: string
  /** The first message, sent as the Pane opens: the Banda menu's words. */
  ask?: string
}

/** A Thread not yet started, on this computer's first Harness. */
export const NEW_THREAD: ThreadArgs = { thread: null, harness: "", title: "" }

/** What Implement asks the Agent, once plan mode is off. */
const IMPLEMENT = "Implement the plan."

/** The Thread a Pane with `args` shows, and what its Person may do there. */
export function useThreadSession({
  engine,
  space,
  args,
  focused,
  open,
  update,
}: PaneProps<ThreadArgs>) {
  const { thread } = args
  const live = useThread(engine, space, thread)
  const state = live.state === "ready" ? live.view : undefined
  const sending = useAct()
  const acting = useAct()
  const reader = useImageReader(engine, space)
  const harnesses = useHarnesses(engine, space)
  // A new Thread starts on a Harness that is on.
  const offered = useMemo(() => harnesses.filter((h) => h.enabled), [harnesses])
  const harness =
    thread === null
      ? args.harness || offered[0]?.id || ""
      : (state?.harness ?? args.harness)
  const name = harnessName(harnesses, harness) || "the Agent"

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
  // sidebar and the bar (ADR 0011, decision 1).
  const front = useInFront()
  const settled = state && settledTurn(state.turns)
  useEffect(() => {
    if (focused && front && thread !== null && settled)
      markSeen(thread, settled)
  }, [focused, front, thread, settled])

  // A Thread not yet started keeps its settings here until its first
  // message, starting from its Harness's.
  const defaults = useHarnessDefaults(
    engine,
    space,
    thread === null && harness !== "" ? harness : null
  )
  const [drafts, setDrafts] = useState<Record<string, Settings>>({})
  const settings =
    thread === null ? (drafts[harness] ?? defaults?.settings) : state?.settings
  const offer: Offer =
    (thread === null ? defaults?.offer : state?.offer) ?? NO_OFFER
  const configure = (next: Settings) => {
    if (thread === null) {
      setDrafts((drafts) => ({ ...drafts, [harness]: next }))
      return
    }
    void acting.act(() =>
      engine.command("agents.configure", { thread, settings: next }, space)
    )
  }

  const images = useAttachments({
    thread,
    attach: (image: Attaching) => engine.command("agents.attach", image, space),
    reader,
    closed: offer.no_images ? `${name} does not take images.` : undefined,
  })
  // A file dropped or pasted, kept in the Space for the message to name.
  const keep = (file: File) =>
    acting.act(async () => {
      const data = base64Of(await dataUrl(file))
      const kept = await engine.command(
        "agents.keep",
        { name: file.name, data },
        space
      )
      return kept.path
    })
  // The files `@` names come from the Space's folder.
  const findFiles = useCallback(
    (query: string) => engine.call("agents.files", { query }, { space }),
    [engine, space]
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
        space
      )
    )
  /** Sends `text`; an existing Thread changes to `next` first, if given. */
  const go = async (
    text: string,
    images: Image[],
    steer: boolean,
    next?: Settings
  ) => {
    const no = asking && declineOnce(asking.body)
    if (no && text && (await answer(asking.id, no)) === undefined) return false
    const sent = await sending.act(() =>
      engine.command(
        "agents.send",
        // A new Thread starts as its composer shows; an existing one runs
        // with its own settings, which the bar changes as it goes.
        {
          ...(thread === null ? { harness } : { thread }),
          text,
          images: images.map(({ id }) => id),
          settings: thread === null ? (settings ?? null) : (next ?? null),
          steer,
        },
        space
      )
    )
    if (sent && thread === null)
      update({ thread: sent.thread, harness, title: args.title })
    return sent !== undefined
  }
  // Words from the Banda menu start the Thread as the Pane opens, with its
  // Harness's settings (ADR 0017, decision 6). They leave the Pane's args
  // first, so they go once.
  useEffect(() => {
    if (thread !== null || !args.ask || !defaults) return
    const { ask, ...rest } = args
    update(rest)
    void go(ask, [], false)
  })
  // Implement turns plan mode off and asks for the plan, in one command.
  const implement = () => {
    if (settings) void go(IMPLEMENT, [], false, { ...settings, plan: false })
  }
  // A turn's changes open in a Diff Pane beside the Thread, or in the one
  // already open, which then shows them.
  const openDiff = (turn: string, path?: string) => {
    if (thread === null) return
    const title = state?.title ?? args.title
    open(paneOf(diffPane, { thread, turn, path: path ?? null, title }), "right")
  }
  const stop = (turn: TurnView) =>
    void acting.act(() =>
      engine.command("agents.stop", { turn: turn.id }, space)
    )
  const retry = (turn: TurnView) =>
    void acting.act(() =>
      engine.command("agents.retry", { turn: turn.id }, space)
    )
  const queue: QueueActions = {
    onSendNow: ({ turn }) =>
      void acting.act(() =>
        engine.command("agents.steer", { turn: turn.id }, space)
      ),
    onEdit: async ({ turn }, text) =>
      (await acting.act(() =>
        engine.command("agents.edit", { turn: turn.id, text }, space)
      )) !== undefined,
    onRemove: ({ turn }) =>
      void acting.act(() =>
        engine.command("agents.withdraw", { turn: turn.id }, space)
      ),
    editing,
    onEditing: setEditing,
    onContinue: () => {
      if (thread === null) return
      void acting.act(() => engine.command("agents.resume", { thread }, space))
    },
  }

  return {
    live,
    /** The Thread once it has loaded. */
    state,
    /** The turn that runs now, if one does. */
    turn: state && working(state),
    harness,
    /** The Harnesses a new Thread may start on. */
    harnesses: offered,
    /** The Harness's name, as the Thread speaks of its Agent. */
    name,
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
    queue,
    /** Opens the last waiting message to edit, from ↑ in the composer. */
    editLast: last && (() => setEditing(last.item.id)),
  }
}

/** The facts that say a Harness offers something new. */
const OFFERED = { module: "agents", kinds: ["thread.offered"] }

/**
 * What a new Thread on `harness` starts with: full access, and what the
 * Harness last offered, such as its models.
 */
function useHarnessDefaults(
  engine: Engine,
  space: SpaceId,
  harness: string | null
): Defaults | undefined {
  const source = useMemo<Source<Defaults> | null>(
    () =>
      harness === null
        ? null
        : {
            read: () => engine.call("agents.defaults", { harness }, { space }),
            filter: OFFERED,
            apply: () => READ_AGAIN,
          },
    [engine, space, harness]
  )
  const live = useLive(engine, space, source)
  return live.state === "ready" ? live.view : undefined
}
