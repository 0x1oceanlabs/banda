import { useEffect, useRef, useState } from "react"
import {
  type Engine,
  type JsonValue,
  newId,
  type SpaceId,
} from "@bandaso/contract"
import type { Ended, Piece, TerminalId } from "@bandaso/contract/terminal"
import { Surface } from "@bandaso/ghostty"
import { Button } from "@bandaso/ui/components/button"
import { problem as words } from "@bandaso/ui/lib/words"
import { definePane, type PaneProps } from "@bandaso/ui/pane"
import { RotateCcwIcon, SquareTerminalIcon } from "lucide-react"
import { Line } from "./line"
import { onThemeChange, themeOf } from "./theme"

/**
 * A terminal: the Person's shell in the Space's folder, or a program
 * another Pane started with `terminal.open`, such as a Harness's sign-in.
 * That Pane opens this one as `{kind: "terminal.terminal", args:
 * {terminal, title, shell: false}}`. The engine runs the program; Ghostty
 * draws it. Closing the Pane stops the program.
 */
export type TerminalArgs = {
  /** `null` until the Pane picks the ID of the shell it starts. */
  terminal: TerminalId | null
  title: string
  /** It runs the Person's shell, which starts again when it is gone. */
  shell: boolean
}

export const terminalPane = definePane<TerminalArgs>({
  kind: "terminal.terminal",
  module: "terminal",
  title: (args) => args.title,
  icon: SquareTerminalIcon,
  start: { terminal: null, title: "Terminal", shell: true },
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
}: PaneProps<TerminalArgs>) {
  const [chosen] = useState(newId)
  useEffect(() => {
    if (args.terminal === null) update({ ...args, terminal: chosen })
  })
  if (args.terminal === null) return null
  return (
    <Screen
      key={args.terminal}
      engine={engine}
      space={space}
      terminal={args.terminal}
      shell={args.shell}
      focused={focused}
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
  focused,
}: {
  engine: Engine
  space: SpaceId
  terminal: TerminalId
  shell: boolean
  focused: boolean
}) {
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
    const call = (method: string, params: JsonValue) =>
      engine.call(method, params, { space })
    const line = new Line(call, terminal, (error) => setProblem(words(error)))
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
      }
    }
    const follow = () => {
      stop = engine.stream<Piece>(
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
    void (async () => {
      const made = await Surface.create(element, {
        theme: themeOf(element),
        onData: (data) => {
          if (running) line.type(data)
        },
        onResize: (cols, rows) => line.resize({ cols, rows }),
        onSelectionChange: () => {},
        // The Desk's own keys, such as Alt+Arrows, stay the Desk's.
        beforeKey: (event) => !event.defaultPrevented,
        canActivateLink: web,
        onLinkActivate: (text) => {
          if (web(text)) window.open(text, "_blank", "noopener")
        },
        onContextMenu: (event) => event.preventDefault(),
      }).catch((error: unknown) => {
        fail(error)
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
    const stopWatchingTheme = onThemeChange(() =>
      drawn?.setTheme(themeOf(element))
    )
    return () => {
      left = true
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
        // The Desk leaves the program its keys, such as Ctrl+W.
        data-keys="program"
        className="relative min-h-0 flex-1 overflow-hidden [--app-scrollbar-thumb-hover:var(--muted-foreground)] [--app-scrollbar-thumb:var(--border)] [--app-scrollbar-width:8px]"
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
  const said =
    now.is === "ended"
      ? endWords(now.ended, shell)
      : now.is === "gone"
        ? now.why
        : problem
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
