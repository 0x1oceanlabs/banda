import { useEffect, useEffectEvent, useRef, useState } from "react"
import {
  type CommandCall,
  type Engine,
  type MethodOf,
  newId,
  type Params,
  type ProjectId,
} from "@banda/contract"
import {
  type Ended,
  type Piece,
  TERMINAL_FILE,
  type TerminalId,
  type Title,
} from "@banda/contract/terminal"
import { type Clock, Surface } from "@banda/ghostty"
import { Button } from "@banda/ui/components/button"
import { afterMoves, cancelFrame } from "@banda/ui/lib/frames"
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@banda/ui/components/context-menu"
import { linkHint, outsideClick } from "@banda/ui/lib/links"
import { problem as words } from "@banda/ui/lib/words"
import { definePane, type PaneProps, PROGRAM_KEYS } from "@banda/ui/pane"
import { RotateCcwIcon, TerminalIcon } from "lucide-react"
import { Input } from "./input"
import { outsideOf, type Target, targetOf } from "./links"
import { type MenuAt, TerminalMenu } from "./TerminalMenu"
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
  /** A line typed into the shell once it runs, and then forgotten, so a
   * reload never types it again: a reply's Run (ADR 0063, decision 6). */
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
  closed: ({ engine, project, args }) => {
    if (args.terminal === null) return
    engine
      .call("terminal.close", { terminal: args.terminal }, { project })
      .catch(() => undefined)
  },
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
}: PaneProps<TerminalArgs>) {
  const [chosen] = useState(newId)
  useEffect(() => {
    if (args.terminal === null) update({ ...args, terminal: chosen })
  })
  // Only a shell's: the engine follows what runs in front of a shell. It
  // changes too often to keep in the layout.
  const titled = (title: Title) =>
    label?.({ title: title.program, detail: title.folder })
  // A link opens in Banda's browser, and with Ctrl outside it, as one in
  // a Thread: a page in the system's browser, a file in its app. Where no
  // window runs actions, a page opens outside and a path is no link.
  const followed = (target: Target, outside: boolean) => {
    if ("file" in target) {
      const action = outside ? "file.outside" : "file.open"
      run?.(action, { file: target.file, project, line: target.line ?? null })
    } else if (outside || !run) {
      window.open(target.page, "_blank", "noopener")
    } else run("browser.open", { address: target.page, project })
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
      files={run !== undefined}
      paste={run && (() => run("edit.paste"))}
      line={args.typed ?? null}
      lineTyped={() => update({ ...args, typed: null })}
    />
  )
}

type Now =
  | { is: "starting" }
  | { is: "running" }
  | { is: "ended"; ended: Ended }
  | { is: "gone"; why: string }

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
  files,
  paste,
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
  /** Whether a path is a link: there is a window to open its file. */
  files: boolean
  /** Pastes into what has the focus; none where no window does. */
  paste?: () => void
  /** A line to type once the program runs; `lineTyped` once it is. */
  line: string | null
  lineTyped: () => void
}) {
  // The newest, so a title heard in a stream started earlier reaches the
  // Pane as it is now.
  const heardTitle = useEffectEvent(titled)
  const heardLink = useEffectEvent(followed)
  // What runs in front, last heard: where the paths it prints start.
  const front = useRef<Title>(undefined)
  // Where a link goes, from where the program is now.
  const linked = useEffectEvent((text: string) => {
    const target = targetOf(text, front.current)
    return target && ("page" in target || files) ? target : null
  })
  const mount = useRef<HTMLDivElement>(null)
  const surface = useRef<Surface | null>(null)
  const focusedNow = useRef(focused)
  const again = useRef<() => void>(() => {})
  const [now, setNow] = useState<Now>({ is: "starting" })
  const [problem, setProblem] = useState<string>()
  const [menuAt, setMenuAt] = useState<MenuAt>({ link: null, selection: "" })
  // Types to the program while it runs, as the menu's Clear does.
  const typed = useRef<(data: string) => void>(() => {})
  // Its own zoom, kept till the window starts again; `terminal.toml`
  // keeps its size. Its actions take Ctrl+− from the program, as
  // Ghostty's and kitty's do, which readline would read as undo.
  const { zoom, by, shown } = useZoom(terminal)
  // The newest `terminal.toml`, for a surface made, or a snapshot heard,
  // after it came.
  const writing = useFile(TERMINAL_FILE)
  const writingNow = useRef(writing)
  const refont = useRef<() => void>(() => {})

  useEffect(() => {
    focusedNow.current = focused
    if (focused) surface.current?.focus()
  }, [focused])

  // Once only, and forgotten then: the Pane's args keep it till typed.
  const forget = useEffectEvent(lineTyped)
  const lineSent = useRef(false)
  useEffect(() => {
    if (!line || lineSent.current || now.is !== "running") return
    lineSent.current = true
    typed.current(`${line}\r`)
    forget()
  }, [line, now])

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
    let stop = () => {}
    let running = false
    // Set once the screen came, so a shell the engine lost starts again
    // once, not over and over.
    let followed = false
    const call = <M extends MethodOf<"call">>(method: M, params: Params<M>) =>
      engine.call(method, params, { project })
    const input = new Input(call, terminal, (error) => setProblem(words(error)))
    typed.current = (data) => {
      if (running) input.type(data)
    }
    const told = (next: Now) => {
      running = next.is === "running"
      setNow(next)
    }
    const fail = (error: unknown) => told({ is: "gone", why: words(error) })
    const start = () =>
      call("terminal.open", {
        terminal,
        size: { cols: drawn?.cols ?? 80, rows: drawn?.rows ?? 24 },
      })
    const hear = (piece: Piece) => {
      if (!drawn) return
      switch (piece.kind) {
        case "snapshot":
          followed = true
          drawn.resetAndWrite(piece.history)
          drawn.setSharedGrid(piece.size)
          told(
            piece.ended
              ? { is: "ended", ended: piece.ended }
              : { is: "running" }
          )
          break
        case "output":
          drawn.write(piece.text)
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
      stop = engine.stream(
        project,
        "terminal.watch",
        { terminal },
        hear,
        (refusal) => {
          if (left) return
          if (refusal?.code === "not_found" && shell && followed) {
            followed = false
            void start().then(follow, fail)
            return
          }
          told({
            is: "gone",
            why: refusal?.message ?? "This terminal was closed.",
          })
        }
      )
    }
    again.current = () => {
      stop()
      setProblem(undefined)
      told({ is: "starting" })
      void start().then(follow, fail)
    }
    let sized = false
    let settling: ReturnType<typeof setTimeout> | undefined
    const fontNow = () => fontOf(element, writingNow.current, zoomOf(terminal))
    void (async () => {
      const made = await Surface.create(element, {
        clock: CLOCK,
        theme: themeOf(element),
        font: fontNow(),
        cursor: cursorOf(writingNow.current),
        onData: (data) => typed.current(data),
        onResize: (cols, rows) => {
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
        linkTitle: (text) => hintOf(linked(text)),
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
      if (focusedNow.current) made.focus()
      if (shell) void start().then(follow, fail)
      else follow()
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
      drawn?.dispose()
      surface.current = null
    }
  }, [engine, project, terminal, shell])

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

  // Its keys (ADR 0071): the zoom, which draws its font again.
  const scope = useScope(TERMINAL, zoomHandlers("terminal", by), {
    tile: true,
  })
  useEffect(() => refont.current(), [zoom])

  return (
    <div ref={scope} className="relative flex h-full min-h-0 flex-col">
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
              className="relative min-h-0 flex-1 overflow-hidden [--app-scrollbar-width:8px]"
            />
          }
        />
        <TerminalMenu
          at={menuAt}
          follow={followed}
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
      <ZoomBadge zoom={shown} />
      <Status
        now={now}
        problem={problem}
        shell={shell}
        onAgain={() => again.current()}
      />
    </div>
  )
}

function Status({
  now,
  problem,
  shell,
  onAgain,
}: {
  now: Now
  problem: string | undefined
  shell: boolean
  onAgain: () => void
}) {
  const said = [
    now.is === "ended" ? endWords(now.ended, shell) : undefined,
    now.is === "gone" ? now.why : undefined,
    problem,
  ]
    .filter(Boolean)
    .join(" ")
  if (!said) return null
  const startable = shell && (now.is === "ended" || now.is === "gone")
  return (
    <footer
      role="status"
      className="flex shrink-0 items-center gap-2 border-t px-2.5 py-1.5 text-xs text-muted-foreground"
    >
      <span className="min-w-0 flex-1">{said}</span>
      {startable && (
        <Button variant="outline" size="xs" onClick={onAgain}>
          <RotateCcwIcon data-icon="inline-start" />
          Start again
        </Button>
      )}
    </footer>
  )
}

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
    "page" in target ? target.page : target.file,
    outsideOf(target)
  )
}
