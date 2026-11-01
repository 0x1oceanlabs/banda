import { useCallback, useEffect, useRef, useState } from "react"
import {
  type AgentId,
  type Engine,
  newId,
  type SpaceId,
} from "@bandaso/contract"
import type {
  Account,
  AgentView,
  Program,
  SignInWay,
} from "@bandaso/contract/agents"
import type { Ended, Piece, TerminalId } from "@bandaso/contract/terminal"
import { Button } from "@bandaso/ui/components/button"
import { Spinner } from "@bandaso/ui/components/spinner"
import { useAct } from "@bandaso/ui/hooks/use-act"
import { useRead } from "@bandaso/ui/hooks/use-read"
import { useModules } from "@bandaso/ui/hooks/use-status"
import { problem as words } from "@bandaso/ui/lib/words"
import type { PaneProps } from "@bandaso/ui/pane"
import {
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  LogInIcon,
  SquareTerminalIcon,
} from "lucide-react"
import { commandLine, signInFailed } from "./sign-in"

/** How a Pane opens another, as the Desk gives it. */
export type Open = PaneProps<unknown>["open"]

/**
 * Signing in to an Agent's Harness, from a turn that failed because its
 * Person must: the ways the Harness offers. One it does by itself, as
 * Codex does in the browser, signs in at a click; one in a terminal runs
 * in a terminal Pane, and its program ending well says it worked. Then
 * the turn goes again. Bandaso holds none of the account's credentials.
 */
export function SignIn({
  engine,
  space,
  agent,
  open,
  onSignedIn,
}: {
  engine: Engine
  space: SpaceId
  agent: AgentId
  open: Open
  onSignedIn: () => void
}) {
  const found = useRead(
    useCallback(async () => {
      const agents = await engine.call<AgentView[]>(
        "agents.list",
        {},
        { space }
      )
      const harness = agents.find((a) => a.id === agent)?.harness
      if (harness === undefined) return null
      const account = await engine.call<Account>(
        "agents.account",
        { harness },
        { space }
      )
      return { harness, ways: account.ways }
    }, [engine, space, agent])
  )
  if (found.state === "loading") return <Spinner />
  if (found.state === "refused")
    return <Problem>{found.refusal.message}</Problem>
  if (found.value === null) return null
  const { harness, ways } = found.value
  return (
    <Ways
      engine={engine}
      space={space}
      harness={harness}
      ways={ways}
      open={open}
      onSignedIn={onSignedIn}
    />
  )
}

/** The ways a Harness offers to sign in, each with what it takes. */
export function Ways({
  engine,
  space,
  harness,
  ways,
  open,
  onSignedIn,
}: {
  engine: Engine
  space: SpaceId
  harness: string
  ways: SignInWay[]
  open: Open
  onSignedIn: () => void
}) {
  const signing = useAct()
  const terminals = useModules(engine).includes("terminal")
  const signIn = async (way: SignInWay) => {
    const done = await signing.act(() =>
      engine.command("agents.sign_in", { harness, way: way.id }, space)
    )
    if (done !== undefined) onSignedIn()
  }
  return (
    <div className="flex flex-col gap-2">
      {ways.length === 0 && (
        <span className="text-xs text-muted-foreground">
          Sign in from a terminal, then try again.
        </span>
      )}
      {ways.map((way) =>
        way.terminal ? (
          <TerminalWay
            key={way.id}
            engine={engine}
            space={space}
            harness={harness}
            way={way}
            program={way.terminal}
            terminals={terminals}
            open={open}
            busy={signing.busy}
            onSignIn={() => void signIn(way)}
          />
        ) : (
          <Way
            key={way.id}
            way={way}
            busy={signing.busy}
            onSignIn={() => void signIn(way)}
          />
        )
      )}
      {signing.problem && <Problem>{signing.problem}</Problem>}
    </div>
  )
}

/** A way the Harness signs in by itself: a button. */
function Way({
  way,
  busy,
  onSignIn,
}: {
  way: SignInWay
  busy: boolean
  onSignIn: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="xs" disabled={busy} onClick={onSignIn}>
        <LogInIcon data-icon="inline-start" />
        Sign in with {way.name}
      </Button>
      {way.description && (
        <span className="text-xs text-muted-foreground">{way.description}</span>
      )}
    </div>
  )
}

type Run =
  | { is: "idle" }
  | { is: "starting" }
  | { is: "running" }
  | { is: "failed"; problem: string }

/**
 * The terminal each way's sign-in runs in, by Space, Harness and way. It
 * outlives the card that started it: opening the terminal Pane splits the
 * card's tile, which draws the card again.
 */
const runningIn = new Map<string, TerminalId>()

/**
 * A sign-in in a terminal: `start` runs the way's program in a terminal
 * Pane and watches it; its ending with code 0 calls `onSignIn`.
 */
function useTerminalSignIn(
  engine: Engine,
  space: SpaceId,
  key: string,
  onSignIn: () => void
) {
  const [run, setRun] = useState<Run>(() =>
    runningIn.has(key) ? { is: "running" } : { is: "idle" }
  )
  const stop = useRef<() => void>(() => {})
  const signIn = useRef(onSignIn)
  useEffect(() => {
    signIn.current = onSignIn
  })
  const watch = useCallback(
    (terminal: TerminalId) => {
      stop.current()
      const ended = (how: Ended) => {
        runningIn.delete(key)
        stop.current()
        const failed = signInFailed(how)
        if (failed === null) signIn.current()
        else setRun({ is: "failed", problem: failed })
      }
      stop.current = engine.stream<Piece>(
        space,
        "terminal.watch",
        { terminal },
        (piece) => {
          if (piece.kind === "exited") ended(piece.ended)
          if (piece.kind === "snapshot" && piece.ended) ended(piece.ended)
        },
        (refusal) => {
          runningIn.delete(key)
          setRun({
            is: "failed",
            problem:
              refusal?.message ??
              "The terminal closed before the sign-in ended. Try again.",
          })
        }
      )
    },
    [engine, space, key]
  )
  useEffect(() => {
    const terminal = runningIn.get(key)
    if (terminal) watch(terminal)
    return () => stop.current()
  }, [key, watch])
  const start = async (program: Program, open: Open, title: string) => {
    stop.current()
    setRun({ is: "starting" })
    const terminal = newId()
    try {
      await engine.call("terminal.open", { terminal, ...program }, { space })
    } catch (error) {
      setRun({ is: "failed", problem: words(error) })
      return
    }
    // All at once, before the Desk draws the card again.
    runningIn.set(key, terminal)
    setRun({ is: "running" })
    open(
      { kind: "terminal.terminal", args: { terminal, title, shell: false } },
      "below"
    )
    watch(terminal)
  }
  return { run, start }
}

/**
 * A way in a terminal. It runs in a terminal Pane below, which the
 * terminal module draws; its program ending with code 0 says the Person
 * signed in. The line stays to run by hand, where no terminal runs here
 * or the Person would rather.
 */
function TerminalWay({
  engine,
  space,
  harness,
  way,
  program,
  terminals,
  open,
  busy,
  onSignIn,
}: {
  engine: Engine
  space: SpaceId
  harness: string
  way: SignInWay
  program: Program
  terminals: boolean
  open: Open
  busy: boolean
  onSignIn: () => void
}) {
  const { run, start } = useTerminalSignIn(
    engine,
    space,
    `${space} ${harness} ${way.id}`,
    onSignIn
  )
  const line = commandLine(program)
  const what = `${way.name}${way.description ? ` (${way.description.trim()})` : ""}`
  return (
    <div className="flex flex-col gap-1.5">
      {terminals ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="xs"
            disabled={busy || run.is === "starting" || run.is === "running"}
            onClick={() => void start(program, open, `Sign in: ${way.name}`)}
          >
            <SquareTerminalIcon data-icon="inline-start" />
            Sign in with {way.name}
          </Button>
          {run.is === "running" ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Spinner /> Sign in in the terminal below.
            </span>
          ) : (
            way.description && (
              <span className="text-xs text-muted-foreground">
                {way.description}
              </span>
            )
          )}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">
          {what}: run this in a terminal, sign in, then come back.
        </span>
      )}
      {run.is === "failed" && <Problem>{run.problem}</Problem>}
      {terminals && (
        <span className="text-xs text-muted-foreground">
          Or run it yourself, then say you signed in:
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
          {line}
        </code>
        <Copy text={line} />
      </div>
      <div>
        <Button variant="outline" size="xs" disabled={busy} onClick={onSignIn}>
          <CheckIcon data-icon="inline-start" />I signed in
        </Button>
      </div>
    </div>
  )
}

function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Copy the command"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => setCopied(true))
      }
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

export function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-xs text-destructive">
      {children}
    </p>
  )
}

/** Something to know that stops nothing, such as a CLI older than its
 * Harness supports. */
export function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-start gap-1.5 text-xs text-muted-foreground"
    >
      <CircleAlertIcon className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
