/**
 * An account's page in Settings → Agents (ADR 0093, decision 9): its
 * emblem large on its colour, its name to edit in place, whether new
 * Threads start on it, what its Harness says of it, its limits, what
 * Banda knows of it, its emblem's picker, and how its entry starts.
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { Defaults, Settings } from "@banda/contract/agents"
import type {
  Account,
  HarnessView,
  Icon,
  Limits,
  UpdateAccount,
} from "@banda/contract/harnesses"
import { tomlOf } from "@banda/contract/settings"
import { Button } from "@banda/ui/components/button"
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
  COLOUR_NAMES,
  Emblem,
  ICON_NAMES,
  emblemColour,
  iconGroupsOf,
} from "@banda/ui/components/emblem"
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
import { useFence } from "@banda/ui/hooks/use-status"
import { useWrite } from "@banda/ui/hooks/use-write"
import { cn } from "@banda/ui/lib/utils"
import { problem } from "@banda/ui/lib/words"
import { clock } from "@banda/core/react"
import {
  ArrowLeftIcon,
  CheckIcon,
  FileCogIcon,
  LogOutIcon,
  RotateCwIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react"
import { useAccount, useHarnesses } from "../harnesses"
import { AccountLogin } from "./AccountLogin"
import { commandLine, wordsOf } from "../thread/sign-in"
import { Problem, Ways, Warning } from "../thread/SignIn"
import { outOf, usedOf } from "../thread/starts-on"
import { SettingsBar } from "./ThreadSettings"
import type { Props } from "./AgentsSettings"
import {
  KIND_WORDS,
  type Use,
  lastWords,
  pickStart,
  threadsWords,
} from "./accounts"

/** Which account new Threads start on, and which while it is out. */
export type Roles = { default?: string; fallback?: string }

type PageProps = Props & {
  harness: HarnessView
  /** Its Harness's name, as its group shows it. */
  of: string
  limits?: Limits
  now: number
  use?: Use
  roles: Roles
}

/** An account's page. */
export function AccountPage({
  onBack,
  ...props
}: PageProps & { onBack: () => void }) {
  const { engine, harness, harnesses, roles, project } = props
  const { refused, write } = useWrite({ against: harness })
  const update = (change: Omit<UpdateAccount, "harness">) =>
    write(
      engine
        .command("harnesses.update_account", {
          harness: harness.id,
          ...change,
        })
        .then(() => [])
    )
  // The page opens at its top, wherever the cards were scrolled.
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" })
  }, [harness.id])
  return (
    <div
      ref={top}
      role="group"
      aria-label={harness.name}
      className="flex flex-col gap-4"
    >
      <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
        <ArrowLeftIcon />
        Accounts
      </Button>
      <Hero
        harness={harness}
        of={props.of}
        onName={(name) => update({ name })}
        toggle={
          <Switch
            label={`${harness.name} on`}
            on={harness.enabled}
            onChange={(enabled) => update({ enabled })}
          />
        }
      />
      {refused.map((message) => (
        <Problem key={message}>{message}</Problem>
      ))}
      {harness.enabled ? (
        <>
          <RoleButtons harness={harness} roles={roles} engine={engine} />
          <Reading {...props} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Off: no new Thread starts on it.
        </p>
      )}
      <Section title="Limits">
        <LimitRows limits={props.limits} now={props.now} />
      </Section>
      <Section title="In Banda">
        <Facts
          rows={[
            ["Threads", threadsWords(props.use?.threads ?? 0)],
            ["Last used", lastWords(props.use?.last, props.now)],
            ["This week", `${props.use?.turns ?? 0} Turns`],
          ]}
        />
      </Section>
      <Section title="Emblem">
        <EmblemPicker
          harness={harness}
          onIcon={(icon) => update({ icon })}
          onColour={(colour) => update({ colour })}
        />
      </Section>
      {harness.enabled && project && (
        <Section title="New Threads on it">
          <NewThreads {...props} project={project} write={write} />
        </Section>
      )}
      <Row
        title="Remove"
        about="Moves its Threads to the default after their current Turn. Keeps its profile signed in."
      >
        <Remove
          engine={props.engine}
          harness={harness}
          roles={roles}
          count={props.use?.threads}
          onRemoved={onBack}
        />
      </Row>
      <Section title="How it starts">
        <HowItStarts harness={harness} file={harnesses} write={write} />
      </Section>
    </div>
  )
}

/** The emblem large on its colour, the name to edit in place, and its
 * Harness and kind. */
function Hero({
  harness,
  of,
  onName,
  toggle,
}: {
  harness: HarnessView
  of: string
  onName: (name: string) => void
  toggle: ReactNode
}) {
  const commit = (text: string) => {
    const name = text.trim()
    if (name && name !== harness.name) onName(name)
  }
  return (
    <div
      className="flex items-center gap-3 rounded-card p-4"
      style={{
        background: `color-mix(in srgb, ${emblemColour(harness)} 14%, transparent)`,
      }}
    >
      <Emblem of={harness} className="size-10" />
      <div className="min-w-0 flex-1">
        <Input
          // A new name from the file starts the field afresh.
          key={harness.name}
          aria-label="Account name"
          defaultValue={harness.name}
          className="-ml-2 h-8 border-transparent bg-transparent px-2 text-base font-semibold shadow-none hover:border-input focus-visible:bg-background dark:bg-transparent"
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(event.currentTarget.value)
          }}
        />
        <p className="text-xs text-muted-foreground">
          {of} · {KIND_WORDS[harness.kind]}
        </p>
      </div>
      {toggle}
    </div>
  )
}

/** "Make default" and "Use as fallback", as New Threads chooses them. */
function RoleButtons({
  harness,
  roles,
  engine,
}: {
  harness: HarnessView
  roles: Roles
  engine: Engine
}) {
  const { refused, write } = useWrite()
  const isDefault = roles.default === harness.id
  const isFallback = roles.fallback === harness.id
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-pressed={isDefault}
          className={cn(isDefault && "border-ring")}
          disabled={isDefault}
          onClick={() => write(pickStart(engine, "account", harness.id))}
        >
          {isDefault && <CheckIcon />}
          {isDefault ? "Default" : "Make default"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={isFallback}
          className={cn(isFallback && "border-ring")}
          disabled={isDefault}
          title={isDefault ? "The default is not its own fallback." : undefined}
          onClick={() =>
            write(
              pickStart(engine, "fallback", isFallback ? undefined : harness.id)
            )
          }
        >
          {isFallback && <CheckIcon />}
          {isFallback ? "Fallback" : "Use as fallback"}
        </Button>
      </div>
      {refused.map((message) => (
        <Problem key={message}>{message}</Problem>
      ))}
    </div>
  )
}

/** What a Harness runs: the Person's CLI with its version, through its
 * adapter. */
function runs({ cli, adapter }: Account): string {
  const own = cli && [cli.path.split("/").pop(), cli.version].filter(Boolean)
  const through = adapter && `${adapter.name} ${adapter.version}`
  return [own?.join(" "), through].filter(Boolean).join(" · ")
}

/** Asks the Harness, which starts it if it does not run; again at a
 * Person's "check again", and as its account changes. */
function Reading(props: PageProps) {
  const { engine, harness } = props
  const [checks, setChecks] = useState(0)
  const read = useAccount(engine, harness.id, checks)
  const account = read.state === "ready" ? read.view.account : undefined
  return (
    <Section
      title="Signed in"
      action={
        read.state !== "loading" && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Check ${harness.name} again`}
            title="Check again"
            onClick={() => setChecks((n) => n + 1)}
          >
            <RotateCwIcon />
          </Button>
        )
      }
    >
      {read.state === "loading" && (
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Starting {harness.name}…
        </span>
      )}
      {read.state === "refused" && (
        <Problem>
          {harness.name} does not start: {read.refusal.message}
        </Problem>
      )}
      {account?.cli?.outdated && <Warning>{account.cli.outdated}</Warning>}
      {account && <AccountState {...props} account={account} />}
      {account && <Facts rows={[["Runs", runs(account), account.cli?.path]]} />}
    </Section>
  )
}

/** Who is signed in, as the Harness says, and signing in or out. The
 * email shows here and on the card, never in a Thread (decision 6). */
function AccountState({
  engine,
  project,
  harness,
  open,
  limits,
  account,
}: PageProps & { account: Account }) {
  const who = account.signed_in_as
  if (who?.signed_in)
    return (
      <div className="flex flex-col items-start gap-2">
        <Facts
          rows={[
            ["Plan", limits?.plan ?? who.label],
            ["Email", who.email ?? limits?.email],
            ["Organization", who.organization],
            ["Sign-in", who.detail ? `Holds (${who.detail})` : "Holds"],
          ]}
        />
        {account.signs_out && <SignOut engine={engine} harness={harness} />}
      </div>
    )
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {who
          ? "Not signed in."
          : `${harness.name} does not say who is signed in.`}
      </p>
      {["claude", "codex"].includes(harness.harness) ? (
        <AccountLogin engine={engine} harness={harness.id} />
      ) : (
        <Ways
          engine={engine}
          project={project}
          harness={harness.id}
          ways={account.ways}
          open={open}
        />
      )}
    </div>
  )
}

/** Each of its limit windows, how much of it is spent and when it starts
 * again; or why there are none. */
function LimitRows({ limits, now }: { limits?: Limits; now: number }) {
  if (!limits || limits.windows.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {limits?.note ?? "Banda reads no limits of it."}
      </p>
    )
  const out = outOf(limits, now)
  return (
    <div className="flex flex-col gap-1.5">
      {limits.windows.map((window) => {
        const used = usedOf(window, now)
        return (
          <div
            key={window.id}
            className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm"
          >
            <span className="truncate">{window.label}</span>
            <Meter label={window.label} used={used} />
            <span className="text-xs text-muted-foreground tabular-nums">
              {Math.round(used)}%
              {window.resets_at !== undefined &&
                ` · ${clock(window.resets_at, now)}`}
            </span>
          </div>
        )
      })}
      {out && (
        <p className="text-xs text-destructive">
          Out{out.until === undefined ? "" : ` until ${clock(out.until, now)}`}.
        </p>
      )}
    </div>
  )
}

/** A limit window's bar: grey, amber from 80%, red when spent. */
export function Meter({ label, used }: { label: string; used: number }) {
  return (
    <div
      className="h-1 overflow-hidden rounded-full bg-foreground/10"
      role="meter"
      aria-label={`${label} used`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(used)}
    >
      <div
        className={cn(
          "h-full rounded-full",
          used >= 100
            ? "bg-destructive"
            : used >= 80
              ? "bg-warning"
              : "bg-muted-foreground/70"
        )}
        style={{ width: `${used}%` }}
      />
    </div>
  )
}

/** The icons the account may take, by their groups, and the colours. */
export function EmblemPicker({
  harness,
  onIcon,
  onColour,
}: {
  harness: HarnessView
  onIcon: (icon: Icon) => void
  onColour: (colour: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {iconGroupsOf(harness.harness).map(({ group, icons }) => (
        <div key={group} role="group" aria-label={group}>
          <p className="mb-1 text-xs text-muted-foreground">{group}</p>
          <div className="flex flex-wrap gap-1">
            {icons.map((icon) => (
              <Button
                key={icon}
                variant="ghost"
                size="icon-sm"
                aria-label={ICON_NAMES[icon]}
                title={ICON_NAMES[icon]}
                aria-pressed={harness.icon === icon}
                className={cn(harness.icon === icon && "ring-2 ring-ring")}
                onClick={() => onIcon(icon)}
              >
                <Emblem of={{ ...harness, icon }} className="size-5" />
              </Button>
            ))}
          </div>
        </div>
      ))}
      <div role="group" aria-label="Colour" className="flex gap-2 pt-1">
        {COLOUR_NAMES.map((name, colour) => (
          <button
            key={name}
            type="button"
            aria-label={name}
            title={name}
            aria-pressed={harness.colour === colour}
            className={cn(
              "size-5 rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring",
              harness.colour === colour && "ring-2 ring-ring"
            )}
            style={{ background: emblemColour({ ...harness, colour }) }}
            onClick={() => onColour(colour)}
          />
        ))}
      </div>
    </div>
  )
}

/** A part of the page, under a small heading. */
function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="flex h-6 items-center justify-between text-xs font-medium text-muted-foreground uppercase">
        {title}
        {action}
      </h3>
      {children}
    </section>
  )
}

/** Names and their values, one a row; a row with no value is left out.
 * A third value is the value's tooltip. */
function Facts({ rows }: { rows: [string, string | undefined, string?][] }) {
  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
      {rows
        .filter(([, value]) => value)
        .map(([name, value, title]) => (
          <div key={name} className="contents">
            <dt className="text-muted-foreground">{name}</dt>
            <dd className="min-w-0 truncate" title={title}>
              {value}
            </dd>
          </div>
        ))}
    </dl>
  )
}

/** What a new Thread on the Harness starts with, `agents.toml`'s
 * `[start.<id>]`: the composer's own bar, over what the Harness offered in
 * this Project. */
function NewThreads({
  engine,
  project,
  harness,
  agents,
  onFence,
  write,
}: PageProps & {
  project: ProjectId
  write: (said: Promise<string[]>) => void
}) {
  // Asked again after its own writes, and as the window comes to the
  // front, for the Person's own edits.
  const [writes, setWrites] = useState(0)
  const front = useInFront()
  const read = useRead(
    useCallback(
      () =>
        engine.call("agents.defaults", { harness: harness.id }, { project }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- asked again on purpose
      [engine, project, harness.id, writes, front]
    )
  )
  const fence = useFence(engine)
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
      title="Starts with"
      about={`What a new Thread on it starts with.${offer.options.length > 0 ? "" : ` Its model shows once a Thread here has run on ${harness.name}.`}`}
    >
      <SettingsBar
        settings={settings}
        offer={offer}
        disabled={false}
        onChange={onChange}
        fence={{ fence, onLearn: onFence }}
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
  file: Props["harnesses"]
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
    <div className="flex flex-col divide-y">
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
    </div>
  )
}

/** A setting: its name and what it does, then its control. */
export function Row({
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
  engine,
  harness,
  roles,
  count,
  onRemoved,
}: {
  engine: Engine
  harness: HarnessView
  roles: Roles
  count?: number
  onRemoved: () => void
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string>()
  // The default its machine names is on, so its Threads can go there.
  const target = useHarnesses(engine).find((h) => h.id === roles.default)
  const canRemove = target !== undefined && target.id !== harness.id
  const remove = async () => {
    setBusy(true)
    setRefused(undefined)
    try {
      await engine.command("harnesses.remove_account", {
        harness: harness.id,
        to: target?.id,
      })
      onRemoved()
    } catch (error) {
      setRefused(problem(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>
        <Trash2Icon />
        Remove
      </Button>
      <Dialog
        open={asking}
        onOpenChange={(open) => {
          if (!busy) setAsking(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {harness.name}?</DialogTitle>
            <DialogDescription>
              {canRemove
                ? `${count === undefined ? "Its Threads move" : count === 1 ? "1 Thread moves" : `${count} Threads move`} to ${target.name} after their current Turn. History stays. Its profile stays signed in and is kept for existing sessions.`
                : "Choose another enabled default Account before removing this one."}
            </DialogDescription>
          </DialogHeader>
          {refused && <Problem>{refused}</Problem>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              disabled={!canRemove || busy}
              onClick={() => void remove()}
            >
              {busy && <Spinner />}Remove account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SignOut({
  engine,
  harness,
}: {
  engine: Engine
  harness: HarnessView
}) {
  const [asking, setAsking] = useState(false)
  const signing = useAct()
  const signOut = async () => {
    const done = await signing.act(() =>
      engine.command("harnesses.sign_out", { harness: harness.id })
    )
    if (done !== undefined) setAsking(false)
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
              terminal too. Its Agents in every Project stop until someone signs
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
