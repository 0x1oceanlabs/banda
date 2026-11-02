import { useEffect, useEffectEvent, useRef, useState } from "react"
import {
  type CommandCall,
  type Engine,
  type MethodOf,
  newId,
  type Params,
  type SpaceId,
} from "@banda/contract"
import type { Ended, Piece, TerminalId, Title } from "@banda/contract/terminal"
import { Surface } from "@banda/ghostty"
import { Button } from "@banda/ui/components/button"
import { problem as words } from "@banda/ui/lib/words"
import { definePane, type PaneProps, PROGRAM_KEYS } from "@banda/ui/pane"
import { RotateCcwIcon, TerminalIcon } from "lucide-react"
import { Input } from "./input"
import { fontOf, onThemeChange, themeOf } from "./theme"

/** How long a size holds before the shell hears it, in ms. */
const SETTLE = 120

/**
 * A terminal: the Person's shell in the Space's folder, or a program
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
  title: string
  /** Where what runs in front works, once the engine said. */
  folder?: string | null
  /** It runs the Person's shell, which starts again when it is gone. */
  shell: boolean
  /** What to send once the program ended with code 0; then the Pane closes. */
  done: Done | null
}

/**
 * A command the Pane sends once its program ended with code 0: how the
 * Pane that opened it hears that it ended well, as a sign-in's does. Its
 * ID keeps it once only, whichever window sends it, after any reload.
 */
export type Done = CommandCall

export const terminalPane = definePane<TerminalArgs>({
  kind: "terminal.terminal",
  title: (args) => args.title,
  detail: (args) => args.folder ?? null,
  // Its title and folder change as it runs; its terminal does not.
  identity: (args) => args.terminal,
  icon: TerminalIcon,
  start: { terminal: null, title: "Terminal", shell: true, done: null },
  letter: "T",
  closed: ({ engine, space, args }) => {
    if (args.terminal === null) return
    engine
      .call("terminal.close", { terminal: args.terminal }, { space })
      .catch(() => undefined)
  },
  Pane: TerminalPane,
})

function TerminalPane({
  engine,
  space,
  args,
  focused,
  update,
  close,
}: PaneProps<TerminalArgs>) {
  const [chosen] = useState(newId)
  useEffect(() => {
    if (args.terminal === null) update({ ...args, terminal: chosen })
  })
  // Only a shell's: the engine follows what runs in front of a shell.
  const titled = (title: Title) => {
    if (args.title === title.program && args.folder === title.folder) return
    update({ ...args, title: title.program, folder: title.folder })
  }
  if (args.terminal === null) return null
  return (
    <Screen
      key={args.terminal}
      engine={engine}
      space={space}
      terminal={args.terminal}
      shell={args.shell}
      done={args.done}
      focused={focused}
      close={close}
      titled={titled}
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
  space,
  terminal,
  shell,
  done,
  focused,
  close,
  titled,
}: {
  engine: Engine
  space: SpaceId
  terminal: TerminalId
  shell: boolean
  done: Done | null
  focused: boolean
  close: () => void
  titled: (title: Title) => void
}) {
  // The newest, so a title heard in a stream started earlier sees the
  // newest args.
  const heardTitle = useEffectEvent(titled)
  const mount = useRef<HTMLDivElement>(null)
  const surface = useRef<Surface | null>(null)
  const focusedNow = useRef(focused)
  const again = useRef<() => void>(() => {})
  const [now, setNow] = useState<Now>({ is: "starting" })
  const [problem, setProblem] = useState<string>()

  useEffect(() => {
    focusedNow.current = focused
    if (focused) surface.current?.focus()
  }, [focused])

  // Once only in this Pane; the command's ID keeps it once everywhere.
  const sent = useRef(false)
  useEffect(() => {
    if (!done || sent.current) return
    if (now.is !== "ended" || now.ended.code !== 0) return
    sent.current = true
    engine
      .run(done, space)
      .then(close, (error: unknown) => setProblem(words(error)))
  }, [done, now, engine, space, close])

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
      engine.call(method, params, { space })
    const input = new Input(call, terminal, (error) => setProblem(words(error)))
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
          heardTitle(piece.title)
          break
      }
    }
    const follow = () => {
      stop = engine.stream(
        space,
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
    void (async () => {
      const made = await Surface.create(element, {
        theme: themeOf(element),
        font: fontOf(element),
        onData: (data) => {
          if (running) input.type(data)
        },
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
        // The window's own keys, such as Alt+Arrows, stay the window's.
        beforeKey: (event) => !event.defaultPrevented,
        canActivateLink: web,
        onLinkActivate: (text) => {
          if (web(text)) window.open(text, "_blank", "noopener")
        },
        onContextMenu: (event) => event.preventDefault(),
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
    let font = JSON.stringify(fontOf(element))
    const stopWatchingTheme = onThemeChange(() => {
      drawn?.setTheme(themeOf(element))
      const now = fontOf(element)
      if (JSON.stringify(now) === font) return
      font = JSON.stringify(now)
      void drawn?.setFont(now)
    })
    return () => {
      left = true
      clearTimeout(settling)
      stop()
      stopWatchingTheme()
      drawn?.dispose()
      surface.current = null
    }
  }, [engine, space, terminal, shell])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={mount}
        role="region"
        aria-label="Terminal screen"
        data-state={now.is}
        {...PROGRAM_KEYS}
        className="relative min-h-0 flex-1 overflow-hidden [--app-scrollbar-width:8px]"
      />
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

function web(text: string): boolean {
  return /^https?:\/\//i.test(text)
}
