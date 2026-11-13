import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  type CommandCall,
  type Engine,
  type JsonValue,
  type MethodOf,
  newId,
  type Params,
  type ProjectId,
  Unreachable,
} from "@banda/contract"
import {
  type Drawn,
  type Ended,
  type Piece,
  TERMINAL_FILE,
  type TerminalId,
  type Title,
} from "@banda/contract/terminal"
import { type Clock, Surface } from "@banda/ghostty"
import { usePlaced } from "@banda/core/react"
import { Button } from "@banda/ui/components/button"
import { afterMoves, cancelFrame } from "@banda/ui/lib/frames"
import { type Configure, onTileFocus, tileOf } from "@banda/ui/lib/tile"
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@banda/ui/components/context-menu"
import { linkHint, outsideClick } from "@banda/ui/lib/links"
import { problem as words } from "@banda/ui/lib/words"
import { definePane, type PaneProps, PROGRAM_KEYS } from "@banda/ui/pane"
import {
  KeyboardOffIcon,
  PowerIcon,
  RotateCcwIcon,
  TerminalIcon,
} from "lucide-react"
import { Input } from "./input"
import { outsideOf, type Target, targetOf } from "./links"
import { type MenuAt, TerminalMenu, THIS_DEVICE } from "./TerminalMenu"
import { onThemeChange, useFile } from "@banda/ui/lib/look"
import { cursorOf, fontOf, themeOf } from "./theme"
import { ZoomBadge } from "@banda/ui/components/zoom-badge"
import { useScope } from "@banda/ui/hooks/use-scope"
import { useZoom, zoomHandlers } from "@banda/ui/hooks/use-zoom"
import { TERMINAL } from "./scopes"
import { zoomOf } from "@banda/ui/lib/zoom"

/** How long a size holds before the shell hears it, in ms. */
const SETTLE = 120

/** The screen draws on the window's clock, after the moves, once a tick
 * at most and only when it changed (ADR 0088, decision 3). */
const CLOCK: Clock = { ask: afterMoves, cancel: cancelFrame }

/**
 * A terminal: the Person's shell in the Project's folder, or a program
 * another Pane started with `terminal.open`, such as a Harness's sign-in.
 * That Pane opens this one as `{kind: "terminal.terminal", args:
 * {terminal, title, shell: false, done}}`. The engine runs the program;
 * Ghostty draws it. Closing the Pane stops the program. A shell's header
 * says what runs in it and where, as `pnpm dev` in `~/code/banda`; another
 * program's keeps the title it was opened with.
 */
export type TerminalArgs = {
  /** `null` until the Pane picks the ID of the shell it starts. */
  terminal: TerminalId | null
  /** Its header's words till the engine says what runs in front. */
  title: string
  /** It runs the Person's shell, which starts again when it is gone. */
  shell: boolean
  /** What to send once the program ended with code 0, in order, each
   * only once the one before went through, as `a && b` does; then the
   * Pane closes. */
  done: Done[] | null
  /** A line typed into the shell this Pane's first open starts, and then
   * forgotten, so a reload or a reconnect never types it: a reply's Run
   * (ADR 0063, decision 6; ADR 0106, decision 4). */
  typed?: string | null
}

/**
 * A command the Pane sends once its program ended with code 0, and where
 * it runs: in `project`, or with none, on the machine (ADR 0040, decision
 * 5). It is how the Pane that opened it hears that it ended well, as a
 * sign-in's does. Its ID keeps it once only, whichever window sends it,
 * after any reload.
 */
export type Done = CommandCall & { project?: ProjectId }

/** `done` as a list: a Pane kept from before the list has one call, sent
 * in its Project. That shape goes once no window keeps such a Pane. */
function listed(
  done: Done[] | CommandCall | null,
  project: ProjectId
): Done[] | null {
  if (done === null || Array.isArray(done)) return done
  return [{ ...done, project }]
}

/** A new shell in the focused Project, from a key or the Pane launcher. */
export const NEW_TERMINAL: TerminalArgs = {
  terminal: null,
  title: "Terminal",
  shell: true,
  done: null,
}

export const terminalPane = definePane<TerminalArgs>({
  kind: "terminal.terminal",
  title: (args) => args.title,
  // A line typed once is not what the Pane is: forgetting it keeps the
  // Pane, and its program.
  identity: (args) => ({ ...args, typed: null }),
  icon: TerminalIcon,
  start: NEW_TERMINAL,
  letter: "T",
  // The shell runs on its Project's machine and this device only draws
  // it (ADR 0106, decision 4).
  elsewhere: true,
  // Its shell stops with it; one its machine did not hear, as it was
  // away, stops there once it is back (ADR 0106, decision 4).
  closed: ({ engine, project, args }) =>
    args.terminal === null
      ? undefined
      : engine.call("terminal.close", { terminal: args.terminal }, { project }),
  Pane: TerminalPane,
})

function TerminalPane({
  engine,
  project,
  args,
  focused,
  update,
  close,
  label,
  run,
  runs,
}: PaneProps<TerminalArgs>) {
  const [chosen] = useState(newId)
  // The Pane that picks its shell's ID opened it just now. One that came
  // with an ID, restored after a restart, types no line: only the shell
  // its first open started takes one (ADR 0106, decision 4).
  const fresh = args.terminal === chosen
  useEffect(() => {
    if (args.terminal === null) update({ ...args, terminal: chosen })
    else if (args.typed && !fresh) update({ ...args, typed: null })
  })
  // Only a shell's: the engine follows what runs in front of a shell. It
  // changes too often to keep in the layout.
  const titled = (title: Title) =>
    label?.({ title: title.program, detail: title.folder })
  // Whether an action runs from this Pane, as the router says for its
  // Project (ADR 0106, law 6); none does where no window runs them.
  const can = (action: string, asked?: { [key: string]: JsonValue }) =>
    run !== undefined && runs?.(action, asked).runs !== false
  // Whether a link opens in Banda's browser: another machine's opens no
  // page yet.
  const inBanda = (target: Target) =>
    "file" in target || can("browser.open", { address: target.link.url })
  // Whether a file opens in its app here: only one this computer holds
  // has one (ADR 0106, decision 3).
  const inItsApp = (target: Target) =>
    "file" in target && can("file.outside", { file: target.file, project })
  // A link opens in Banda's browser, and with Ctrl outside it, as one in
  // a Thread: a page in this device's browser, a file in its app. Where
  // Banda's browser cannot take it, a page goes to the device's. Each goes
  // through the router, so no link leaves this Pane past it.
  const followed = (target: Target, outside: boolean) => {
    if ("file" in target) {
      const action = outside && inItsApp(target) ? "file.outside" : "file.open"
      run?.(action, { file: target.file, project, line: target.line ?? null })
    } else if (!outside && inBanda(target)) {
      run?.("browser.open", { address: target.link.url, project })
    } else run?.("link.open", { url: target.link.url })
  }
  // Why a page does not open on this device, as `localhost` on arc, which
  // is arc's own; none where it does.
  const whyNot = (target: Target) => {
    if (!("link" in target)) return undefined
    const opens = runs?.("link.open", { url: target.link.url })
    return opens && !opens.runs ? opens.why : undefined
  }
  // Under the pointer, a page Banda's browser cannot take says where it
  // opens, or whose it is.
  const hinted = (target: Target | null) => {
    if (target && "file" in target && !inItsApp(target))
      return linkHint(target.file, null)
    if (!target || !("link" in target) || inBanda(target)) return hintOf(target)
    return whyNot(target) ?? `Opens in ${THIS_DEVICE}'s browser`
  }
  if (args.terminal === null) return null
  return (
    <Screen
      key={args.terminal}
      engine={engine}
      project={project}
      terminal={args.terminal}
      shell={args.shell}
      done={listed(args.done, project)}
      focused={focused}
      close={close}
      titled={titled}
      followed={followed}
      inBanda={inBanda}
      opensHere={(target) =>
        "file" in target ? inItsApp(target) : whyNot(target) === undefined
      }
      hinted={hinted}
      files={can("file.open", { file: "", project })}
      paste={can("edit.paste") ? () => run?.("edit.paste") : undefined}
      fresh={fresh}
      line={fresh ? (args.typed ?? null) : null}
      lineTyped={() => update({ ...args, typed: null })}
    />
  )
}

type Now =
  | { is: "starting" }
  | { is: "running" }
  | { is: "ended"; ended: Ended }
  /** Its engine restarted while the shell ran, which ended it: the screen
   * it drew stays, when the Pane stayed on that engine, and the foot says
   * why. */
  | { is: "restarted" }
  | { is: "gone"; why: string }
  /** A shell opened while its machine was away, which never started. */
  | { is: "none" }

function Screen({
  engine,
  project,
  terminal,
  shell,
  done,
  focused,
  close,
  titled,
  followed,
  inBanda,
  opensHere,
  hinted,
  files,
  paste,
  fresh,
  line,
  lineTyped,
}: {
  engine: Engine
  project: ProjectId
  terminal: TerminalId
  shell: boolean
  done: Done[] | null
  focused: boolean
  close: () => void
  titled: (title: Title) => void
  followed: (target: Target, outside: boolean) => void
  /** Whether a link opens in Banda's browser too. */
  inBanda: (target: Target) => boolean
  /** Whether a link opens from this device at all. */
  opensHere: (target: Target) => boolean
  /** What a link says under the pointer. */
  hinted: (target: Target | null) => string
  /** Whether a path is a link: there is a window to open its file, and
   * its machine's files are open to this device. */
  files: boolean
  /** Pastes into what has the focus; none where no window does. */
  paste?: () => void
  /** This Pane picked its shell's ID as it opened: no shell has it yet. */
  fresh: boolean
  /** A line to type into the shell the first open starts; `lineTyped`
   * once it is, or once that open failed and it never will be. */
  line: string | null
  lineTyped: () => void
}) {
  // The newest, so a title heard in a stream started earlier reaches the
  // Pane as it is now.
  const heardTitle = useEffectEvent(titled)
  const heardLink = useEffectEvent(followed)
  const hint = useEffectEvent(hinted)
  // What runs in front, last heard: where the paths it prints start.
  const front = useRef<Title>(undefined)
  // Where a link goes, from where the program is now.
  const linked = useEffectEvent((text: string) => {
    const target = targetOf(text, front.current)
    return target && ("link" in target || files) ? target : null
  })
  const mount = useRef<HTMLDivElement>(null)
  const surface = useRef<Surface | null>(null)
  const focusedNow = useRef(focused)
  // A focus given while its Tile was hidden, which a hidden screen takes
  // not: it takes it as it shows.
  const owed = useRef(false)
  const again = useRef<(what: string) => void>(() => {})
  // The boot of the engine the screen came from. A shell gone under
  // another boot went with that engine, and what ran in it with it, so
  // the Pane says so rather than start another by itself (ADR 0106,
  // decision 4). Kept here as a new engine may take the old one's place
  // while the Pane stays.
  const heardUnder = useRef<string>(undefined)
  const [now, setNow] = useState<Now>({ is: "starting" })
  const [problem, setProblem] = useState<string>()
  // What was typed while its machine was away, and the honest note.
  const [notSent, setNotSent] = useState<{ said: string; note: string }>()
  // Its machine heard again, on the same connection or a new one, what was
  // refused while away no longer stands, whatever the shell says next.
  // Its owner's status is all a Pane reads of the link (ADR 0106, law 5).
  const { host, shown } = usePlaced(project, undefined)
  const reached = shown === undefined || shown.state.state === "live"
  const [wasReached, setWasReached] = useState(reached)
  if (wasReached !== reached) {
    setWasReached(reached)
    if (reached) setNotSent(undefined)
  }
  const [menuAt, setMenuAt] = useState<MenuAt>({ link: null, selection: "" })
  // Types to the program while it runs, as the menu's Clear does.
  const typed = useRef<(data: string) => void>(() => {})
  // Its own zoom, kept till the window starts again; `terminal.toml`
  // keeps its size. Its actions take Ctrl+− from the program, as
  // Ghostty's and kitty's do, which readline would read as undo.
  const { zoom, by, shown: zoomShown } = useZoom(terminal)
  // The newest `terminal.toml`, for a surface made, or a snapshot heard,
  // after it came.
  const writing = useFile(TERMINAL_FILE)
  const writingNow = useRef(writing)
  const refont = useRef<() => void>(() => {})

  useEffect(() => {
    focusedNow.current = focused
    const element = mount.current
    owed.current = false
    if (!focused || !element) return
    // A terminal reads keys only in its field, so one given to its tile,
    // as what closes over a Pane gives them, goes on to the field.
    const take = () => {
      owed.current = tileOf(element).now().state === "hidden"
      surface.current?.focus()
    }
    take()
    return onTileFocus(element, take)
  }, [focused])

  // The line waits for the first open: typed into the shell it started,
  // or dropped if it failed, so a Run never lands later by itself, after
  // a reconnect or a restart (ADR 0106, decision 4).
  const forget = useEffectEvent(lineTyped)
  const lineLeft = useRef(line)
  // Once only in this Pane; the command's ID keeps it once everywhere.
  const sent = useRef(false)
  useEffect(() => {
    if (!done || sent.current) return
    if (now.is !== "ended" || now.ended.code !== 0) return
    sent.current = true
    const run = async () => {
      for (const call of done) await engine.run(call, call.project)
    }
    run().then(close, (error: unknown) => setProblem(words(error)))
  }, [done, now, engine, project, close])

  useEffect(() => {
    const element = mount.current
    if (!element) return
    let left = false
    let drawn: Surface | null = null
    // The grid this Pane last measured, which goes to the program when the
    // terminal says another: its size reached no one while away (#1224).
    let measured: { cols: number; rows: number } | null = null
    // The first open was refused as its machine is away. It watches for
    // the shell all the same, a read that waits, and hears once it is back.
    let parked = false
    let stop = () => {}
    let running = false
    // Set once the screen came, so a shell the engine lost starts again
    // once, not over and over. A Pane drawn again on a new engine, its
    // last one having said goodbye, has had its screen.
    let followed = heardUnder.current !== undefined
    // Set while the screen draws output its terminal printed while this
    // Pane was not heard: its answers to that are not typed.
    let old = false
    const call = <M extends MethodOf<"call">>(method: M, params: Params<M>) =>
      engine.call(method, params, { project })
    const input = new Input(call, terminal, (error) => {
      const said = words(error, "your typing")
      if (error instanceof Unreachable)
        setNotSent({
          said,
          note: `What was typed before ${error.machine} went away may still arrive once it is back.`,
        })
      else setProblem(said)
    })
    // A key goes to a shell that runs, and to one its machine has parked,
    // so a key there says it was not sent rather than vanish.
    typed.current = (data) => {
      if (running || parked) input.type(data)
    }
    // Whatever the Pane now says of its shell, its machine, or the Person
    // starting it again, has answered the key refused before.
    const told = (next: Now) => {
      running = next.is === "running"
      setNotSent(undefined)
      setNow(next)
    }
    const fail = (error: unknown) => told({ is: "gone", why: words(error) })
    const start = () =>
      call("terminal.open", {
        terminal,
        size: { cols: drawn?.cols ?? 80, rows: drawn?.rows ?? 24 },
      })
    // How much of the terminal's output this screen has drawn, as its
    // pieces said: after a reconnect the watch goes on from here, with no
    // screen again (`terminal.watch {after}`). None from an engine older
    // than that, which sends the whole screen each time.
    let seen: Drawn | undefined
    const hear = (piece: Piece) => {
      if (!drawn) return
      switch (piece.kind) {
        case "snapshot":
        case "resumed":
          if (piece.kind === "snapshot") {
            drawn.resetAndWrite(piece.history)
            seen = piece.drawn
          } else {
            // The screen is as it was drawn, and what it missed is old:
            // a query in it is answered no more than a snapshot's is.
            old = true
            try {
              drawn.write(piece.missed)
            } finally {
              old = false
            }
            if (seen) seen = { ...seen, at: piece.at }
          }
          followed = true
          parked = false
          heardUnder.current = bootOf(engine)
          drawn.setSharedGrid(piece.size)
          input.inOrder(piece.in_order === true)
          if (
            measured &&
            (measured.cols !== piece.size.cols ||
              measured.rows !== piece.size.rows)
          )
            input.resize(measured)
          told(
            piece.ended
              ? { is: "ended", ended: piece.ended }
              : { is: "running" }
          )
          break
        case "output":
          drawn.write(piece.text)
          if (seen && piece.at !== undefined) seen = { ...seen, at: piece.at }
          break
        case "resized":
          drawn.setSharedGrid(piece.size)
          break
        case "exited":
          told({ is: "ended", ended: piece.ended })
          break
        case "titled":
          front.current = piece.title
          heardTitle(piece.title)
          break
      }
    }
    const follow = () => {
      if (left) return
      stop = engine.stream(
        project,
        "terminal.watch",
        // Asked again after a reconnect, it says what it drew by then.
        () => ({ terminal, ...(seen && { after: seen }) }),
        hear,
        (refusal) => {
          if (left) return
          if (
            refusal?.code === "not_found" &&
            followed &&
            bootOf(engine) !== heardUnder.current
          ) {
            followed = false
            told({ is: "restarted" })
            return
          }
          if (refusal?.code === "not_found" && shell && followed) {
            followed = false
            void start().then(follow, fail)
            return
          }
          if (parked && fresh && refusal?.code === "not_found") {
            parked = false
            told({ is: "none" })
            return
          }
          told({
            is: "gone",
            why: refusal?.message ?? "This terminal was closed.",
          })
        }
      )
    }
    again.current = (what) => {
      stop()
      setProblem(undefined)
      told({ is: "starting" })
      void start().then(follow, (error: unknown) =>
        told({ is: "gone", why: words(error, what) })
      )
    }
    let sized = false
    let settling: ReturnType<typeof setTimeout> | undefined
    const fontNow = () => fontOf(element, writingNow.current, zoomOf(terminal))
    // Its Tile's state (ADR 0088, decision 4): hidden, the screen draws
    // nothing and stops its cursor's blink, and the program runs on;
    // shown again, it draws what it missed at once, and takes a focus
    // given meanwhile.
    const tile = tileOf(element)
    let hidden = tile.now().state === "hidden"
    const obey = ({ state }: Configure) => {
      if (hidden === (state === "hidden")) return
      hidden = state === "hidden"
      drawn?.setVisible(!hidden)
      if (hidden || !owed.current) return
      owed.current = false
      if (focusedNow.current) drawn?.focus()
    }
    const stopObeying = tile.watch(obey)
    // Its size and the screen's scale come from its Tile too, through its
    // resize gate (decision 5): the screen fits as the Tile says, and has
    // no observer of its own.
    const byTile = (fit: () => void, rescale: () => void) => {
      let { size, scale } = tile.now()
      return tile.watch((now) => {
        if (now.scale !== scale) {
          ;({ size, scale } = now)
          rescale()
        } else if (now.size !== size) {
          size = now.size
          fit()
        }
      })
    }
    void (async () => {
      const made = await Surface.create(element, {
        // Made hidden, it takes its grid and draws nothing; it shows below,
        // as its Tile does.
        visible: false,
        clock: CLOCK,
        sized: byTile,
        theme: themeOf(element),
        font: fontNow(),
        cursor: cursorOf(writingNow.current),
        // What the screen answers to output drawn late types nothing.
        onData: (data) => old || typed.current(data),
        onResize: (cols, rows) => {
          measured = { cols, rows }
          // The screen redraws at every size as a column grows; the shell
          // hears the first size at once, and then only where it settles.
          clearTimeout(settling)
          if (!sized) {
            sized = true
            input.resize({ cols, rows })
            return
          }
          settling = setTimeout(() => input.resize({ cols, rows }), SETTLE)
        },
        onSelectionChange: () => {},
        // A key an action took, the window's as Alt+Arrows or the
        // terminal's own zoom, is not the program's.
        beforeKey: (event) => !event.defaultPrevented,
        canActivateLink: (text) => linked(text) !== null,
        onLinkActivate: (text, event) => {
          const target = linked(text)
          if (target) heardLink(target, outsideClick(event))
        },
        linkTitle: (text) => hint(linked(text)),
        // The menu opens here, unless the program took the right click.
        onContextMenu: (event) => {
          const text = drawn?.linkTextAt(event.clientX, event.clientY)
          setMenuAt({
            link: text ? linked(text) : null,
            selection: drawn?.getSelection() ?? "",
          })
        },
      }).catch((error: unknown) => {
        const why = error instanceof Error ? `: ${error.message}` : "."
        told({ is: "gone", why: `This window cannot draw a terminal${why}` })
        return null
      })
      if (!made) return
      if (left) return made.dispose()
      drawn = made
      surface.current = made
      made.setVisible(!hidden)
      if (focusedNow.current) made.focus()
      // A program is another Pane's to start; a shell that had a screen is
      // looked for first, so a new boot is heard rather than answered with
      // a new shell.
      if (!shell || heardUnder.current !== undefined) return follow()
      void start().then(
        () => {
          if (left) return
          const text = lineLeft.current
          lineLeft.current = null
          if (text) {
            input.type(`${text}\r`)
            forget()
          }
          follow()
        },
        (error: unknown) => {
          if (left) return
          if (lineLeft.current) forget()
          lineLeft.current = null
          if (!(error instanceof Unreachable)) return fail(error)
          // Its machine is away: the pill says so, nothing here does. The
          // shell, or that it has none, is heard once it is back.
          parked = true
          follow()
        }
      )
    })()
    let font = JSON.stringify(fontNow())
    refont.current = () => {
      const now = fontNow()
      if (JSON.stringify(now) === font) return
      font = JSON.stringify(now)
      void drawn?.setFont(now)
    }
    const stopWatchingTheme = onThemeChange(() => {
      drawn?.setTheme(themeOf(element))
      refont.current()
    })
    return () => {
      left = true
      clearTimeout(settling)
      stop()
      stopWatchingTheme()
      stopObeying()
      drawn?.dispose()
      surface.current = null
    }
  }, [engine, project, terminal, shell, fresh])

  // A change to `terminal.toml` reaches a screen already drawn: its font,
  // and its cursor, over what a program asked for. A new look with the
  // same file changes nothing.
  useEffect(() => {
    const was = writingNow.current
    writingNow.current = writing
    if (JSON.stringify(was) === JSON.stringify(writing)) return
    refont.current()
    surface.current?.setCursor(cursorOf(writing))
  }, [writing])

  // The footer under the screen takes its room from the screen, inside
  // the Tile, so no Configure says so: the screen fits to what is left as
  // the footer comes, goes or says something else, before the frame shows.
  const said = statusOf(now, problem, shell, shown?.named.name ?? host)
  useLayoutEffect(() => {
    surface.current?.fit()
  }, [said])

  // Its keys (ADR 0071): the zoom, which draws its font again.
  const scope = useScope(TERMINAL, zoomHandlers("terminal", by), {
    tile: true,
  })
  useEffect(() => refont.current(), [zoom])

  return (
    <div ref={scope} className="relative flex h-full min-h-0 flex-col">
      {/* The refused key's words sit in the screen's corner, so they never
          cover the footer and its button. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ContextMenu>
          <ContextMenuTrigger
            onContextMenu={(event) => {
              if (event.defaultPrevented) event.preventBaseUIHandler()
            }}
            render={
              <div
                ref={mount}
                role="region"
                aria-label="Terminal screen"
                data-state={now.is}
                {...PROGRAM_KEYS}
                // Its size is its Tile's, and nothing it draws reaches past
                // it (ADR 0088, decision 8).
                className="relative min-h-0 flex-1 overflow-hidden [contain:strict] [--app-scrollbar-width:8px]"
              />
            }
          />
          <TerminalMenu
            at={menuAt}
            follow={followed}
            inBanda={inBanda}
            opensHere={opensHere}
            selectAll={() => surface.current?.selectAll()}
            type={(data) => typed.current(data)}
            paste={
              paste &&
              (() => {
                surface.current?.focus()
                paste()
              })
            }
          />
        </ContextMenu>
        {notSent && (
          <div
            role="status"
            title={notSent.note}
            className="absolute right-2.5 bottom-2 z-10 inline-flex h-5 items-center gap-1.5 rounded-small border border-input bg-popover px-1.5 text-meta whitespace-nowrap shadow-float"
          >
            <KeyboardOffIcon className="size-3.5 text-attention" />
            <span>{notSent.said}</span>
          </div>
        )}
      </div>
      <ZoomBadge zoom={zoomShown} />
      <Status
        now={now}
        said={said}
        shell={shell}
        onAgain={() => {
          // The button goes as the state changes, and the keys with it.
          surface.current?.focus()
          again.current(againWords(now))
        }}
      />
    </div>
  )
}

/** This boot of `engine`: none while it is not connected. */
const bootOf = (engine: Engine) =>
  engine.status.state === "open" ? engine.status.boot : undefined

/** What the footer under the screen says: none while the program runs
 * well. `machine` is the other machine it runs on, by name. */
function statusOf(
  now: Now,
  problem: string | undefined,
  shell: boolean,
  machine: string | undefined
) {
  return [
    now.is === "ended" ? endWords(now.ended, shell) : undefined,
    now.is === "restarted" ? restartedWords(machine) : undefined,
    now.is === "gone" ? now.why : undefined,
    now.is === "none" ? "This terminal has no shell yet." : undefined,
    problem,
  ]
    .filter(Boolean)
    .join(" ")
}

function Status({
  now,
  said,
  shell,
  onAgain,
}: {
  now: Now
  said: string
  shell: boolean
  onAgain: () => void
}) {
  if (!said) return null
  const startable =
    shell &&
    (now.is === "ended" ||
      now.is === "restarted" ||
      now.is === "gone" ||
      now.is === "none")
  return (
    <footer
      role="status"
      className="flex shrink-0 items-center gap-2 border-t px-2.5 py-1.5 text-meta text-muted-foreground"
    >
      {now.is === "restarted" && <PowerIcon className="size-3.5 shrink-0" />}
      <span className="min-w-0 flex-1">{said}</span>
      {startable && (
        <Button variant="outline" size="xs" onClick={onAgain}>
          {now.is === "restarted" ? (
            <TerminalIcon data-icon="inline-start" />
          ) : (
            <RotateCcwIcon data-icon="inline-start" />
          )}
          {againWords(now)}
        </Button>
      )}
    </footer>
  )
}

/** The footer's button, and what a refusal of it says was not sent. */
const againWords = (now: Now) =>
  now.is === "none"
    ? "Start a shell"
    : now.is === "restarted"
      ? "New shell here"
      : "Start again"

/** That Banda restarted where the terminal ran: on `machine`, or with none
 * on this one. */
const restartedWords = (machine: string | undefined) =>
  machine ? `Ended: Banda restarted on ${machine}` : "Ended: Banda restarted"

/** How a program ended, in words. */
export function endWords(ended: Ended, shell: boolean): string {
  const what = shell ? "The shell" : "The program"
  if (ended.code === 0) return `${what} ended.`
  if (ended.code !== undefined) return `${what} ended with code ${ended.code}.`
  if (ended.signal !== undefined)
    return `${what} was stopped by signal ${ended.signal}.`
  return `${what} ended.`
}

/** What a link says of where a click takes it. */
function hintOf(target: Target | null): string {
  if (!target) return ""
  return linkHint(
    "link" in target ? target.link.url : target.file,
    outsideOf(target)
  )
}
