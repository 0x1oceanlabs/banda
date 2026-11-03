import { useCallback } from "react"
import { type Engine, newId, type SpaceId } from "@banda/contract"
import type { TurnId } from "@banda/contract/agents"
import type { Program, SignInWay } from "@banda/contract/harnesses"
import { Button } from "@banda/ui/components/button"
import { CopyButton } from "@banda/ui/components/copy-button"
import { Spinner } from "@banda/ui/components/spinner"
import { useAct } from "@banda/ui/hooks/use-act"
import { useRead } from "@banda/ui/hooks/use-read"
import { useModules } from "@banda/ui/hooks/use-status"
import type { PaneProps } from "@banda/ui/pane"
import {
  CheckIcon,
  CircleAlertIcon,
  LogInIcon,
  SquareTerminalIcon,
} from "lucide-react"
import { commandLine } from "./sign-in"

/** How a Pane opens another, as the window gives it. */
export type Open = PaneProps<unknown>["open"]

/**
 * Signing in to a Thread's Harness, from a turn that failed because its
 * Person must: the ways the Harness offers. One it does by itself, as
 * Codex does in the browser, signs in at a click; one in a terminal runs
 * in a terminal Pane, and its program ending well says it worked. Then
 * `turn` goes again. Banda holds none of the account's credentials.
 */
export function SignIn({
  engine,
  space,
  harness,
  turn,
  open,
  onSignedIn,
}: {
  engine: Engine
  space: SpaceId
  harness: string
  turn: TurnId
  open: Open
  onSignedIn: () => void
}) {
  const found = useRead(
    useCallback(
      () => engine.call("agents.account", { harness }, { space }),
      [engine, space, harness]
    )
  )
  if (found.state === "loading") return <Spinner />
  if (found.state === "refused")
    return <Problem>{found.refusal.message}</Problem>
  return (
    <Ways
      engine={engine}
      space={space}
      harness={harness}
      ways={found.value.ways}
      turn={turn}
      open={open}
      onSignedIn={onSignedIn}
    />
  )
}

/**
 * The ways a Harness offers to sign in, each with what it takes; `turn`
 * is the one that needed it, when a Thread asks.
 */
export function Ways({
  engine,
  space,
  harness,
  ways,
  turn,
  open,
  onSignedIn,
}: {
  engine: Engine
  space: SpaceId
  harness: string
  ways: SignInWay[]
  turn?: TurnId
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
            turn={turn}
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

/**
 * A way in a terminal. It runs in a terminal Pane below, which the
 * terminal module draws and the window keeps: once its program ended with
 * code 0, that Pane sends the sign-in, which sends the `turn` that needed
 * it again too, and closes. So the sign-in lands even after a reload, or
 * with this card gone. The line stays to run by hand, where no terminal
 * runs here or the Person would rather.
 */
function TerminalWay({
  engine,
  space,
  harness,
  way,
  program,
  turn,
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
  turn: TurnId | undefined
  terminals: boolean
  open: Open
  busy: boolean
  onSignIn: () => void
}) {
  const starting = useAct()
  const start = async () => {
    const terminal = newId()
    const opened = await starting.act(() =>
      engine.call("terminal.open", { terminal, ...program }, { space })
    )
    if (opened === undefined) return
    const signIn = { harness, way: way.id, ...(turn && { turn }) }
    const done = { method: "agents.sign_in", params: signIn, command: newId() }
    const title = `Sign in: ${way.name}`
    open(
      {
        kind: "terminal.terminal",
        args: { terminal, title, shell: false, done },
      },
      "below"
    )
  }
  const line = commandLine(program)
  const what = `${way.name}${way.description ? ` (${way.description.trim()})` : ""}`
  return (
    <div className="flex flex-col gap-1.5">
      {terminals ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              disabled={busy || starting.busy}
              onClick={() => void start()}
            >
              <SquareTerminalIcon data-icon="inline-start" />
              Sign in with {way.name}
            </Button>
            {way.description && (
              <span className="text-xs text-muted-foreground">
                {way.description}
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            It runs in a terminal below.{" "}
            {turn
              ? "Once you signed in there, this turn goes again."
              : "Once you signed in there, check again."}{" "}
            Or run it yourself, then say you signed in:
          </span>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">
          {what}: run this in a terminal, sign in, then come back.
        </span>
      )}
      {starting.problem && <Problem>{starting.problem}</Problem>}
      <div className="flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
          {line}
        </code>
        <CopyButton text={line} label="Copy the command" />
      </div>
      <div>
        <Button variant="outline" size="xs" disabled={busy} onClick={onSignIn}>
          <CheckIcon data-icon="inline-start" />I signed in
        </Button>
      </div>
    </div>
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
