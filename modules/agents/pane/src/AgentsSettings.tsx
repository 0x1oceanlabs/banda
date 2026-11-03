import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import type { Account, Defaults, Settings } from "@banda/contract/agents"
import type { HarnessView } from "@banda/contract/harnesses"
import { tomlOf } from "@banda/contract/settings"
import { Button } from "@banda/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@banda/ui/components/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@banda/ui/components/field"
import { HarnessLogo } from "@banda/ui/components/harness-logo"
import { Input } from "@banda/ui/components/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@banda/ui/components/item"
import { Spinner } from "@banda/ui/components/spinner"
import { Switch } from "@banda/ui/components/switch"
import { useAct } from "@banda/ui/hooks/use-act"
import { useInFront } from "@banda/ui/hooks/use-in-front"
import { useRead } from "@banda/ui/hooks/use-read"
import { useWrite } from "@banda/ui/hooks/use-write"
import { cn } from "@banda/ui/lib/utils"
import { problem } from "@banda/ui/lib/words"
import {
  FileCogIcon,
  LogOutIcon,
  PlusIcon,
  RotateCwIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react"
import { commandLine, wordsOf } from "./sign-in"
import { type Open, Problem, Warning, Ways } from "./SignIn"
import { SettingsBar } from "./ThreadSettings"

/**
 * A settings file, as the settings Pane writes it (ADR 0016): through
 * `banda settings`, which keeps the Person's text and refuses what the
 * engine would not read. Each answers what was wrong, or nothing.
 */
export type SettingsFile = {
  /** Sets `key`, as `harness.codex.enabled`, to a TOML value. */
  set: (key: string, value: string) => Promise<string[]>
  /** Takes `key` out; in `harnesses.toml`, `harness.codex` takes the
   * whole entry out. */
  reset: (key: string) => Promise<string[]>
  /** Opens the file in the Person's editor. */
  reveal: () => void
}

type Props = {
  engine: Engine
  /** The Space each Harness is asked in: an account serves them all. */
  space: SpaceId
  open: Open
  harnesses: SettingsFile
  /** What a new Thread on each Harness starts with is here. */
  agents: SettingsFile
}

/**
 * The settings Pane's Agents (ADR 0016, decision 7), as T3 Code's
 * providers: a card per Harness entry with who is signed in, on or off,
 * and how it starts; adding one. What a message written while an Agent
 * works does is `agents.toml`'s, drawn from its schema under these. The
 * engine reads `harnesses.toml` again once it changed, so the list is
 * asked again after each change, and when the window comes to the front.
 */
export function AgentsSettings({
  lit,
  ...props
}: Props & {
  /** A link's Harness: it shows lit. */
  lit?: string
}) {
  const { engine, space } = props
  const [list, setList] = useState<HarnessView[] | { refused: string }>()
  const readList = useCallback(
    () =>
      void engine
        .call("agents.harnesses", {}, { space })
        .then(setList, (error: unknown) =>
          setList({ refused: problem(error) })
        ),
    [engine, space]
  )
  // Read as the window comes to the front, for the Person's own edits.
  const front = useInFront()
  useEffect(() => {
    if (front) readList()
  }, [front, readList])
  return (
    <div className="flex flex-col gap-4">
      {list === undefined && <Spinner />}
      {list && "refused" in list && <Problem>{list.refused}</Problem>}
      {Array.isArray(list) &&
        list.map((harness) => (
          <HarnessCard
            key={harness.id}
            {...props}
            harness={harness}
            lit={harness.id === lit}
            onWritten={readList}
          />
        ))}
      {Array.isArray(list) && (
        <AddHarness file={props.harnesses} taken={list} onAdded={readList} />
      )}
    </div>
  )
}

type HarnessProps = Props & { harness: HarnessView }

/** A Harness entry: its account, on or off, and how it starts. */
function HarnessCard({
  lit,
  onWritten,
  ...props
}: HarnessProps & { lit: boolean; onWritten: () => void }) {
  const { harness, harnesses } = props
  const { refused, write } = useWrite({ onWritten, against: harness })
  // Asked again after each sign-in or sign-out: a new key, a new reading.
  const [readings, setReadings] = useState(0)
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (lit) card.current?.scrollIntoView({ block: "center" })
  }, [lit])
  const enabled = `harness.${harness.id}.enabled`
  const frame: FrameProps = {
    harness,
    lit,
    card,
    refused,
    toggle: (
      <Switch
        label={`${harness.name} on`}
        on={harness.enabled}
        onChange={(on) =>
          write(on ? harnesses.reset(enabled) : harnesses.set(enabled, "false"))
        }
      />
    ),
    starts: (
      <>
        {harness.enabled && <NewThreads {...props} write={write} />}
        <HowItStarts harness={harness} file={harnesses} write={write} />
      </>
    ),
  }
  return harness.enabled ? (
    <Reading
      key={readings}
      {...props}
      frame={frame}
      readAgain={() => setReadings((n) => n + 1)}
    />
  ) : (
    <Frame {...frame} about="Off: no new Thread starts on it." />
  )
}

type FrameProps = {
  harness: HarnessView
  lit: boolean
  card: React.RefObject<HTMLDivElement | null>
  refused: string[]
  toggle: ReactNode
  starts: ReactNode
}

/** A card as T3 Code draws a provider: its logo and name, what it runs,
 * its switch; who is signed in; how it starts. */
function Frame({
  harness,
  lit,
  card,
  refused,
  toggle,
  starts,
  about,
  aboutTitle,
  action,
  children,
}: FrameProps & {
  about?: string
  aboutTitle?: string
  action?: ReactNode
  children?: ReactNode
}) {
  return (
    <Card
      ref={card}
      size="sm"
      role="group"
      aria-label={harness.name}
      className={cn(lit && "ring-2 ring-primary/60")}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HarnessLogo
            id={harness.id}
            name={harness.name}
            className="size-4"
            fallback={null}
          />
          {harness.name}
        </CardTitle>
        {about && <CardDescription title={aboutTitle}>{about}</CardDescription>}
        <CardAction className="flex items-center gap-1">
          {action}
          {toggle}
        </CardAction>
      </CardHeader>
      {children && (
        <CardContent className="flex flex-col gap-3">{children}</CardContent>
      )}
      <CardContent className="flex flex-col divide-y border-t">
        {starts}
        {refused.map((message) => (
          <Problem key={message}>{message}</Problem>
        ))}
      </CardContent>
    </Card>
  )
}

/** What a Harness runs: the Person's CLI with its version, through its
 * adapter. */
function runs({ cli, adapter }: Account): string {
  const own = cli && [cli.path.split("/").pop(), cli.version].filter(Boolean)
  const through = adapter && `${adapter.name} ${adapter.version}`
  return [own?.join(" "), through].filter(Boolean).join(" · ")
}

/** Asks the Harness, which starts it if it does not run. */
function Reading({
  frame,
  readAgain,
  ...props
}: HarnessProps & { frame: FrameProps; readAgain: () => void }) {
  const { engine, space, harness } = props
  const account = useRead(
    useCallback(
      () => engine.call("agents.account", { harness: harness.id }, { space }),
      [engine, space, harness.id]
    )
  )
  return (
    <Frame
      {...frame}
      about={account.state === "ready" ? runs(account.value) : undefined}
      aboutTitle={
        account.state === "ready" ? account.value.cli?.path : undefined
      }
      action={
        account.state !== "loading" && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Check ${harness.name} again`}
            title="Check again"
            onClick={readAgain}
          >
            <RotateCwIcon />
          </Button>
        )
      }
    >
      {account.state === "loading" && (
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Starting {harness.name}…
        </span>
      )}
      {account.state === "refused" && (
        <Problem>
          {harness.name} does not start: {account.refusal.message}
        </Problem>
      )}
      {account.state === "ready" && account.value.cli?.outdated && (
        <Warning>{account.value.cli.outdated}</Warning>
      )}
      {account.state === "ready" && (
        <AccountState
          {...props}
          account={account.value}
          onChanged={readAgain}
        />
      )}
    </Frame>
  )
}

/** What a new Thread on the Harness starts with, `agents.toml`'s
 * `[start.<id>]`: the composer's own bar, over what the Harness offered in
 * this Space. */
function NewThreads({
  engine,
  space,
  harness,
  agents,
  write,
}: HarnessProps & { write: (said: Promise<string[]>) => void }) {
  // Asked again after its own writes, and as the window comes to the
  // front, for the Person's own edits.
  const [writes, setWrites] = useState(0)
  const front = useInFront()
  const read = useRead(
    useCallback(
      () => engine.call("agents.defaults", { harness: harness.id }, { space }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- asked again on purpose
      [engine, space, harness.id, writes, front]
    )
  )
  // What it was shows while it is asked again.
  const [shown, setShown] = useState<Defaults>()
  if (read.state === "ready" && read.value !== shown) setShown(read.value)
  if (!shown) return null
  const { settings, offer } = shown
  const start = `start.${harness.id}`
  const change = (said: Promise<string[]>) =>
    write(said.finally(() => setWrites((n) => n + 1)))
  const onChange = (next: Settings) => {
    const changed = changeOf(settings, next)
    if (changed)
      change(agents.set(`${start}.${changed[0]}`, tomlOf(changed[1])))
  }
  return (
    <Row
      title="New Threads"
      about={`What a new Thread on it starts with.${offer.options.length > 0 ? "" : ` Its model shows once a Thread here has run on ${harness.name}.`}`}
    >
      <SettingsBar
        settings={settings}
        offer={offer}
        disabled={false}
        onChange={onChange}
      />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`${harness.name}'s own`}
        title="The Harness's own"
        onClick={() => change(agents.reset(start))}
      >
        <Undo2Icon />
      </Button>
    </Row>
  )
}

/** The one key `next` changed from `settings`, and its value. */
function changeOf(
  settings: Settings,
  next: Settings
): [string, string | boolean] | undefined {
  if (next.mode !== settings.mode) return ["mode", next.mode]
  if (next.plan !== settings.plan) return ["plan", next.plan]
  return Object.entries(next.options).find(
    ([id, value]) => settings.options[id] !== value
  )
}

/** How the entry starts its program, as the file says, to change here;
 * its environment's values may be secrets, so they stay in the file. */
function HowItStarts({
  harness,
  file,
  write,
}: {
  harness: HarnessView
  file: SettingsFile
  write: (said: Promise<string[]>) => void
}) {
  const [program = "", ...args] = harness.command
  const line = commandLine({ program, args, env: {} })
  const commit = (text: string) => {
    const [command, ...rest] = wordsOf(text)
    if (!command || text === line) return
    const entry = `{ command = ${tomlOf(command)}, args = ${tomlOf(rest)} }`
    write(file.set(`harness.${harness.id}`, entry))
  }
  return (
    <>
      <Row
        title="Command"
        about="The program that speaks ACP, then its arguments."
      >
        <Input
          // A new value from the file starts the field afresh.
          key={line}
          aria-label={`${harness.name} command`}
          defaultValue={line}
          className="h-8 w-72 max-w-full font-mono text-xs"
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(event.currentTarget.value)
          }}
        />
      </Row>
      <Row
        title="Environment"
        about={
          harness.env.length === 0
            ? "None over yours."
            : `${harness.env.join(", ")}: their values stay in the file.`
        }
      >
        <Button variant="outline" size="sm" onClick={file.reveal}>
          <FileCogIcon />
          Edit in harnesses.toml
        </Button>
      </Row>
      <Row title="Remove" about="Takes the entry out of harnesses.toml.">
        <Remove
          harness={harness}
          onRemove={() => write(file.reset(`harness.${harness.id}`))}
        />
      </Row>
    </>
  )
}

function Row({
  title,
  about,
  children,
}: {
  title: string
  about: string
  children: ReactNode
}) {
  return (
    <Item className="rounded-none px-0">
      <ItemContent className="min-w-40">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className="text-xs">{about}</ItemDescription>
      </ItemContent>
      <ItemActions>{children}</ItemActions>
    </Item>
  )
}

function Remove({
  harness,
  onRemove,
}: {
  harness: HarnessView
  onRemove: () => void
}) {
  const [asking, setAsking] = useState(false)
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>
        <Trash2Icon />
        Remove
      </Button>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {harness.name}?</DialogTitle>
            <DialogDescription>
              Its entry leaves harnesses.toml. Its Threads stay, and cannot go
              on until an entry with the ID {harness.id} is back. Turning it off
              keeps the entry.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setAsking(false)
                onRemove()
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** A new entry: any agent that speaks ACP, or a second account of one. */
function AddHarness({
  file,
  taken,
  onAdded,
}: {
  file: SettingsFile
  taken: HarnessView[]
  onAdded: () => void
}) {
  const [asking, setAsking] = useState(false)
  const [name, setName] = useState("")
  const [id, setId] = useState<string>()
  const [line, setLine] = useState("")
  const wanted = id ?? idOf(name)
  const [command, ...args] = wordsOf(line)
  const wrong = !/^[a-z0-9][a-z0-9-]*$/.test(wanted)
    ? "An ID is small letters, digits and dashes."
    : taken.some((h) => h.id === wanted)
      ? `There is a Harness with the ID ${wanted} already.`
      : undefined
  const ready = !wrong && command !== undefined && name.trim() !== ""
  const { refused, write } = useWrite({
    onWritten: () => {
      setAsking(false)
      setName("")
      setId(undefined)
      setLine("")
      onAdded()
    },
  })
  const add = () => {
    if (!ready || !command) return
    const entry = `{ name = ${tomlOf(name.trim())}, command = ${tomlOf(command)}, args = ${tomlOf(args)} }`
    write(file.set(`harness.${wanted}`, entry))
  }
  return (
    <>
      <Button
        variant="outline"
        className="h-auto min-h-9 justify-start border-dashed text-left whitespace-normal text-muted-foreground"
        onClick={() => setAsking(true)}
      >
        <PlusIcon />
        Add a Harness: any agent that speaks ACP, or a second account
      </Button>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a Harness</DialogTitle>
            <DialogDescription>
              A new entry in harnesses.toml. A second account of one is the same
              command with its own config folder in its environment, which you
              set in the file.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              add()
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="harness-name">Name</FieldLabel>
                <Input
                  id="harness-name"
                  value={name}
                  placeholder="Gemini CLI"
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="harness-id">ID</FieldLabel>
                <Input
                  id="harness-id"
                  value={wanted}
                  onChange={(event) => setId(event.target.value)}
                  className="font-mono"
                />
                <FieldDescription>
                  How Threads name it. It stays: a Thread keeps the ID.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="harness-command">Command</FieldLabel>
                <Input
                  id="harness-command"
                  value={line}
                  placeholder="npx -y @google/gemini-cli --experimental-acp"
                  onChange={(event) => setLine(event.target.value)}
                  className="font-mono"
                />
                <FieldDescription>
                  The program that speaks ACP on its stdio, then its arguments.
                </FieldDescription>
              </Field>
              {name && wrong && <Problem>{wrong}</Problem>}
              {refused.map((message) => (
                <Problem key={message}>{message}</Problem>
              ))}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <DialogClose render={<Button variant="outline" />}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={!ready}>
                Add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** `Gemini CLI` as `gemini-cli`. */
function idOf(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
}

function AccountState({
  engine,
  space,
  harness,
  open,
  account,
  onChanged,
}: Omit<HarnessProps, "harnesses" | "agents"> & {
  account: Account
  onChanged: () => void
}) {
  const who = account.signed_in_as
  if (who?.signed_in)
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm">
          Signed in as {[who.email, who.label].filter(Boolean).join(" · ")}
          {who.detail && (
            <span className="text-muted-foreground"> ({who.detail})</span>
          )}
        </p>
        {account.signs_out && (
          <SignOut
            engine={engine}
            space={space}
            harness={harness}
            onSignedOut={onChanged}
          />
        )}
      </div>
    )
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {who
          ? "Not signed in."
          : `${harness.name} does not say who is signed in.`}
      </p>
      <Ways
        engine={engine}
        space={space}
        harness={harness.id}
        ways={account.ways}
        open={open}
        onSignedIn={onChanged}
      />
    </div>
  )
}

function SignOut({
  engine,
  space,
  harness,
  onSignedOut,
}: Pick<HarnessProps, "engine" | "space" | "harness"> & {
  onSignedOut: () => void
}) {
  const [asking, setAsking] = useState(false)
  const signing = useAct()
  const signOut = async () => {
    const done = await signing.act(() =>
      engine.command("agents.sign_out", { harness: harness.id }, space)
    )
    if (done === undefined) return
    setAsking(false)
    onSignedOut()
  }
  return (
    <>
      <Button variant="outline" size="xs" onClick={() => setAsking(true)}>
        <LogOutIcon data-icon="inline-start" />
        Sign out
      </Button>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out of {harness.name}?</DialogTitle>
            <DialogDescription>
              This signs {harness.name} out on this computer, in your own
              terminal too. Its Agents in every Space stop until someone signs
              in again; their Threads stay.
            </DialogDescription>
          </DialogHeader>
          {signing.problem && <Problem>{signing.problem}</Problem>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              disabled={signing.busy}
              onClick={() => void signOut()}
            >
              {signing.busy && <Spinner />}
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
