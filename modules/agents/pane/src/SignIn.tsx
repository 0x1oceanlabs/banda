import { useCallback, useState } from "react"
import type { AgentId, Engine, SpaceId } from "@bandaso/contract"
import type { Account, AgentView, SignInWay } from "@bandaso/contract/agents"
import { Button } from "@bandaso/ui/components/button"
import { Spinner } from "@bandaso/ui/components/spinner"
import { useAct } from "@bandaso/ui/hooks/use-act"
import { useRead } from "@bandaso/ui/hooks/use-read"
import { CheckIcon, CopyIcon, LogInIcon } from "lucide-react"
import { commandLine } from "./sign-in"

/**
 * Signing in to an Agent's Harness, from a turn that failed because its
 * Person must: the ways the Harness offers. One it does by itself, as
 * Codex does in the browser, signs in at a click; one in a terminal shows
 * the command to run, and the Person says when that is done. Then the
 * turn goes again. Bandaso holds none of the account's credentials.
 */
export function SignIn({
  engine,
  space,
  agent,
  onSignedIn,
}: {
  engine: Engine
  space: SpaceId
  agent: AgentId
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
  onSignedIn,
}: {
  engine: Engine
  space: SpaceId
  harness: string
  ways: SignInWay[]
  onSignedIn: () => void
}) {
  const signing = useAct()
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
      {ways.map((way) => (
        <Way
          key={way.id}
          way={way}
          busy={signing.busy}
          onSignIn={() => void signIn(way)}
        />
      ))}
      {signing.problem && <Problem>{signing.problem}</Problem>}
    </div>
  )
}

function Way({
  way,
  busy,
  onSignIn,
}: {
  way: SignInWay
  busy: boolean
  onSignIn: () => void
}) {
  if (!way.terminal)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="xs" disabled={busy} onClick={onSignIn}>
          <LogInIcon data-icon="inline-start" />
          Sign in with {way.name}
        </Button>
        {way.description && (
          <span className="text-xs text-muted-foreground">
            {way.description}
          </span>
        )}
      </div>
    )
  const line = commandLine(way.terminal)
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">
        {way.name}
        {way.description && ` (${way.description.trim()})`}: run this in a
        terminal, sign in, then come back.
      </span>
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
