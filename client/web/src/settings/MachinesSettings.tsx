/**
 * Settings → Machines (ADR 0095, decision 9): this machine's name and
 * icon, which its own engine writes in its `machine.toml`, and when it
 * stays awake (ADR 0097); each other machine of `hosts.toml`, whose row
 * opens in place, its battery and why it is awake while it is live, its
 * name and icon and whether it stays awake on power written on that
 * machine through its engine while it is live, its address and its
 * `banda` written in `hosts.toml` through the desktop;
 * and Add a machine, which finds it first, then numbers a name and moves
 * an icon that clash with a machine shown, written on the new machine
 * once it first answers (decision 3). Every write here is the Person's:
 * the engines take them as theirs, and the desktop's calls are the
 * window's.
 */
import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { MachineIcon as Icon, Named } from "@banda/contract/machines"
import { tomlOf } from "@banda/contract/settings"
import { Button } from "@banda/ui/components/button"
import { CopyButton } from "@banda/ui/components/copy-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@banda/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { Input } from "@banda/ui/components/input"
import { MachineIcon, MachineMark } from "@banda/ui/components/machine-icon"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { Spinner } from "@banda/ui/components/spinner"
import { Switch } from "@banda/ui/components/switch"
import { useAccount } from "@banda/ui/hooks/use-harnesses"
import { useProjects } from "@banda/ui/hooks/use-projects"
import { useRead } from "@banda/ui/hooks/use-read"
import { cleanNamed, forgetNamed, useStatus } from "@banda/ui/hooks/use-status"
import { shownProjects } from "@banda/ui/lib/projects"
import { cn } from "@banda/ui/lib/utils"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LaptopIcon,
  PlayIcon,
  PlugZapIcon,
  PowerIcon,
  SquareTerminalIcon,
  Undo2Icon,
} from "lucide-react"
import {
  batteryWords,
  type HostEntry,
  HostsContext,
  type HostTest,
  type Shown,
  useHereNamed,
  useHosts,
} from "@banda/core/react"
import { BatteryIcon } from "@banda/ui/components/battery-icon"
import { device } from "../boot"
import { useTurnsOn } from "../calls/battery"
import { useLookProblems, useLookSettings } from "../look"
import { MachinePicker } from "./MachinePicker"
import {
  addedWords,
  AWAKE_ROWS,
  type AwakeKey,
  awakeOn,
  awakeValue,
  awayWords,
  ended,
  failedWords,
  foundNamed,
  installSteps,
  lidWords,
  NAME_MOST,
  NO_ACTS,
  pluggedInThere,
  powerRow,
  renameWords,
  type Settled,
  settle,
  settleWords,
  shellLine,
  showRows,
  shownActs,
  shownOn,
  started,
  testWords,
  Told,
  type Wrote,
} from "./machines"
import { buildWords, factsWords, stateWords } from "../machines/words"
import type { SectionProps } from "./sections"
import { MachineRowsPicker } from "./rows"
import { RowFrame, SettingRow } from "./SettingRow"
import { UpdatesRow } from "./UpdatesRow"

/** A machine's own settings file. */
const FILE = "machine.toml"

/** Writes `key` of `engine`'s machine's `machine.toml`, as the Person;
 * none takes it out, and Banda finds it again, or its own is back. */
const write = (
  engine: Engine,
  key: "name" | "icon" | AwakeKey,
  value: string | boolean | null
) =>
  value === null
    ? engine.call("keys.settings_reset", { file: FILE, key })
    : engine.call("keys.settings_set", {
        file: FILE,
        key,
        value: tomlOf(value),
      })

/** A name as a field gives it: empty goes back to what Banda finds. */
const nameOf = (text: string) => (text === "" ? null : text)

/** Runs the Person's acts, which may overlap, as Enter in a field while
 * a Test runs: busy until every one has ended, with what the latest
 * still running is doing in words (`doing`), and what went wrong in
 * Banda's words (`failedWords`) until the next starts. One that ends
 * first leaves the others busy, their words shown. */
function useAsk() {
  const [acts, setActs] = useState(NO_ACTS)
  const ask = useCallback(
    async <T,>(
      run: () => Promise<T>,
      words = "Working…"
    ): Promise<T | undefined> => {
      const act = { words }
      setActs((now) => started(now, act))
      let failed: string | undefined
      try {
        return await run()
      } catch (error) {
        failed = failedWords(error)
        return undefined
      } finally {
        setActs((now) => ended(now, act, failed))
      }
    },
    []
  )
  return { ...shownActs(acts), ask }
}

/** The Harness "Sign in to Claude on <name>" is of. */
const CLAUDE = "claude"

/** The icons the machines in `others` have, each with their names. */
function takenBy(others: readonly Named[]): ReadonlyMap<Icon, string[]> {
  const taken = new Map<Icon, string[]>()
  for (const { icon, name } of others)
    taken.set(icon, [...(taken.get(icon) ?? []), name])
  return taken
}

/** The machines shown: this one (`here`) first, then those of `hosts`
 * but machine `except`. */
const shownBeside = (
  here: Named | undefined,
  hosts: readonly Shown[],
  except?: string
): Named[] => [
  ...(here ? [here] : []),
  ...hosts.filter((one) => one.name !== except).map((one) => one.named),
]

export function MachinesSettings({ engine, lit, run }: SectionProps) {
  const kept = useContext(HostsContext)
  const hosts = useHosts()
  const here = useHereNamed()
  // This machine as Add's settling reads it once a new machine answers,
  // which may be after this section has gone.
  const hereNow = useRef(here)
  useEffect(() => {
    hereNow.current = here
  }, [here])
  // The machines shown now, but machine `except`.
  const shown = useCallback(
    (except?: string) => shownBeside(hereNow.current, kept.get(), except),
    [kept]
  )
  // "Sign in to Claude on <name>": a terminal here, a shell of a Project
  // here, that runs Claude there over ssh; the window's own action
  // (`terminal.run`) opens it, so not from a dialog of the settings.
  const { listed } = useProjects(engine)
  const project =
    listed.state === "ready"
      ? shownProjects(listed.value).find((one) => !one.missing)?.id
      : undefined
  const claude = useMemo<ClaudeThere>(
    () => ({
      project,
      open:
        run &&
        project !== undefined &&
        (async (ssh) => {
          const line = shellLine(await device.hosts.terminalArgs(ssh, "claude"))
          run("terminal.run", { line: `ssh ${line}`, project })
        }),
    }),
    [project, run]
  )
  return (
    <>
      <ThisMachine engine={engine} named={here} hosts={hosts} lit={lit} />
      <Card size="sm" role="group" aria-label="Other machines">
        <CardHeader>
          <CardTitle>Other machines</CardTitle>
          <CardDescription>
            hosts.toml on {here?.name ?? "this machine"}: whose Projects this
            window shows. Changes apply at once.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col border-t px-0">
          {hosts.length === 0 && (
            <p className="px-(--card-spacing) py-3 text-ui text-muted-foreground">
              No other machine yet. Add one below, and its Projects show under
              its name.
            </p>
          )}
          {hosts.map((host) => (
            <HostRow
              key={host.name}
              host={host}
              lit={lit}
              run={run}
              others={shownBeside(here, hosts, host.name)}
              claude={claude}
            />
          ))}
          <AddMachine here={here} hosts={hosts} shown={shown} claude={claude} />
        </CardContent>
      </Card>
      {hosts.length > 0 && <ShowCard name={here?.name} lit={lit} />}
    </>
  )
}

/** What opens "Sign in to Claude on <name>" (ADR 0119, decision 8): a
 * shell of this machine's `project` in a terminal Pane, where `ssh -t
 * <ssh> claude` is typed, with Banda's own options but free to ask, and
 * the Person signs in with /login. None where there is no Project here,
 * or Settings is a dialog: the Person is given the command. */
type ClaudeThere = {
  project: ProjectId | undefined
  open: ((ssh: string) => Promise<void>) | undefined | false
}

/** "Sign in to Claude on <name>", for the machine at `ssh`. */
function SignInClaude({
  claude,
  ssh,
  name,
  onCheck,
}: {
  claude: ClaudeThere
  ssh: string
  name: string
  /** Reads who is signed in there again. */
  onCheck?: () => void
}) {
  const { busy, problem, ask } = useAsk()
  const { open } = claude
  const line = `ssh -t ${ssh} claude`
  return (
    <div className="flex flex-col gap-1.5">
      {open ? (
        <span className="text-meta text-muted-foreground">
          A terminal here runs Claude on {name}: type /login there.
        </span>
      ) : (
        <>
          <span className="text-meta text-muted-foreground">
            {claude.project === undefined
              ? "No Project here for its terminal: run"
              : "Run"}{" "}
            this in a terminal here, then type /login there.
          </span>
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-control bg-muted px-2 py-1 font-mono text-meta">
              {line}
            </code>
            <CopyButton text={line} label="Copy the command" />
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {open && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void ask(() => open(ssh))}
          >
            <SquareTerminalIcon />
            Sign in to Claude on {name}
          </Button>
        )}
        {onCheck && (
          <Button size="sm" variant="ghost" onClick={onCheck}>
            Check again
          </Button>
        )}
      </div>
      {problem && (
        <p role="alert" className="text-meta text-destructive">
          {problem}
        </p>
      )}
    </div>
  )
}

/** Show (ADR 0095, decision 9): how this machine's windows name the
 * machines, the two keys of `[machines]` in `sidebar.toml`, shown only
 * here, and only with another machine, as with one nothing is named. */
function ShowCard({ name, lit }: { name?: string; lit?: string }) {
  const keyed = useLookSettings()["sidebar.toml"]
  const problems = useLookProblems().filter(({ path }) =>
    path.endsWith("/sidebar.toml")
  )
  const here = name ?? "this machine"
  return (
    <Card size="sm" role="group" aria-label="Show" className="pb-0">
      <CardHeader>
        <CardTitle>Show</CardTitle>
        <CardDescription>
          sidebar.toml on {here}: how windows on {here} name the machines.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y border-t px-0 *:px-(--card-spacing)">
        {showRows(here).map((row) => (
          <SettingRow
            key={row.key}
            row={row}
            setting={keyed?.[row.key]}
            problems={problems.filter((one) => one.key === row.key)}
            lit={lit === row.key}
            Custom={row.key === "machines.rows" ? MachineRowsPicker : undefined}
          />
        ))}
      </CardContent>
    </Card>
  )
}

/** This machine: its icon, which opens the picker; its name; what it is,
 * as its engine says; and when it stays awake, as the look reads its
 * machine.toml, with what its lid does where it has a battery. */
function ThisMachine({
  engine,
  named,
  hosts,
  lit,
}: {
  engine: Engine
  named: Named | undefined
  hosts: readonly Shown[]
  lit?: string
}) {
  const status = useStatus(engine)
  const read = useCallback(() => engine.call("machines.get", {}), [engine])
  const naming = useRead(read)
  const { listed } = useProjects(engine)
  const { busy, problem, ask } = useAsk()
  const keyed = useLookSettings()[FILE]
  // What the Person last set each switch to, over the look's line it was
  // set against: the look heard again says the file afresh.
  const [wrote, setWrote] = useState<Partial<Record<AwakeKey, Wrote>>>({})
  const got = naming.state === "ready" ? naming.value : undefined
  // What Banda finds, which a key machine.toml leaves out takes; each
  // cleaned as a welcome's is, as a hand edit of machine.toml may say
  // anything.
  const found = got && cleanNamed(got.found, "")
  const now = named ?? (got && cleanNamed(got, ""))
  const project =
    listed.state === "ready" ? shownProjects(listed.value)[0] : undefined
  if (!now)
    return (
      <Card size="sm">
        <Spinner />
      </Card>
    )
  // Its model only where it says one cleanly (ADR 0095, decision 9).
  const facts = factsWords([got?.model, got?.system])
  const build =
    status.state === "open"
      ? /^banda (\S+)/.exec(status.engine)?.[1]
      : undefined
  const set = (key: "name" | "icon", value: string | null) =>
    void ask(() => write(engine, key, value))
  const turn = (key: AwakeKey, on: boolean) => {
    const to = keyed?.[key]
    const was = awakeOn(key, keyed, got)
    void ask(async () => {
      await write(engine, key, awakeValue(key, on))
      setWrote((now) => ({ ...now, [key]: { to, was, on } }))
    })
  }
  // What machine.toml changed of what Banda finds, to take out.
  const changed = found
    ? (["name", "icon"] as const).filter((key) => now[key] !== found[key])
    : []
  return (
    <Card
      size="sm"
      role="group"
      aria-label="This machine"
      data-key="this"
      className={cn(lit === "this" && "ring-2 ring-primary/60")}
    >
      <CardHeader>
        <CardTitle>This machine</CardTitle>
        <CardDescription>
          machine.toml on {now.name}. Other windows show it by this name and
          icon.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col border-t px-0 pt-3">
        <div className="flex flex-wrap items-center gap-3 px-(--card-spacing) pb-3">
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="size-11 p-0"
                  aria-label="Change this machine's icon"
                  title="Icon"
                />
              }
            >
              <MachineIcon icon={now.icon} size={20} />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64">
              <MachinePicker
                named={now}
                about={`Written on ${now.name}, for every window.`}
                taken={takenBy(hosts.map((one) => one.named))}
                project={project}
                onName={(name) => set("name", nameOf(name))}
                onIcon={(icon) => set("icon", icon)}
              />
            </PopoverContent>
          </Popover>
          <NameField
            label="This machine's name"
            value={now.name}
            placeholder={found?.name}
            onCommit={(name) => set("name", nameOf(name))}
          />
          {changed.length > 0 && found && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="Back to what Banda finds"
              title={`Back to what Banda finds: ${found.name}, the ${found.icon} icon`}
              disabled={busy}
              onClick={() =>
                void ask(async () => {
                  for (const key of changed) await write(engine, key, null)
                })
              }
            >
              <Undo2Icon />
            </Button>
          )}
          <div className="ml-auto text-right text-meta leading-5 text-muted-foreground">
            {facts && <div>{facts}</div>}
            {build && (
              <div
                className="tabular-nums"
                title={status.state === "open" ? status.engine : undefined}
              >
                Banda {build}
              </div>
            )}
          </div>
        </div>
        {AWAKE_ROWS.map(({ key, title, about }) => (
          <SwitchRow
            key={key}
            dataKey={key}
            title={title}
            about={about(now.name)}
            on={shownOn(awakeOn(key, keyed, got), keyed?.[key], wrote[key])}
            busy={busy}
            onChange={(on) => turn(key, on)}
            className="border-t px-(--card-spacing) py-3 last:pb-0"
          />
        ))}
        <div className="border-t [&>[data-key]]:px-(--card-spacing)">
          <UpdatesRow
            named={now}
            engine={engine}
            live
            lit={lit === "this.updates"}
          />
        </div>
        {got?.battery === true && (
          <p className="flex items-center gap-2 border-t px-(--card-spacing) pt-2.5 text-meta text-muted-foreground">
            <LaptopIcon className="size-3.5 shrink-0" />
            {lidWords(now.name, got.system)}
          </p>
        )}
        {problem && (
          <p
            role="alert"
            className="px-(--card-spacing) pt-2 text-meta text-destructive"
          >
            {problem}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** A setting of a machine.toml as a switch, with what it does; still while
 * `busy`, as while a write runs. */
function SwitchRow({
  dataKey,
  title,
  about,
  on,
  busy,
  onChange,
  className,
}: {
  dataKey: string
  title: string
  about: string
  on: boolean
  busy: boolean
  onChange: (on: boolean) => void
  className?: string
}) {
  return (
    <div
      data-key={dataKey}
      className={cn("flex items-center gap-3", className)}
    >
      <div className="min-w-0 flex-1">
        <div className="text-ui font-medium">{title}</div>
        <div className="text-meta text-muted-foreground">{about}</div>
      </div>
      <BusySwitch label={title} on={on} busy={busy} onChange={onChange} />
    </div>
  )
}

/** A switch that, while `busy`, is greyed, said to be so, and takes no
 * click, yet keeps the focus, as a disabled one would not: the Person
 * turning it by the keys stays on it. */
function BusySwitch({
  label,
  on,
  busy,
  onChange,
}: {
  label: string
  on: boolean
  busy: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <span
      aria-disabled={busy || undefined}
      className={cn("flex", busy && "opacity-50")}
    >
      <Switch
        label={label}
        on={on}
        onChange={(next) => {
          if (!busy) onChange(next)
        }}
      />
    </span>
  )
}

/** A name in a field, written on Enter or as it loses the focus; an
 * empty one goes back to what Banda finds. */
function NameField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string
  value: string
  placeholder?: string
  onCommit: (name: string) => void
}) {
  const commit = (text: string) => {
    if (text.trim() !== value) onCommit(text.trim())
  }
  return (
    <Input
      // A new name from the machine starts the field afresh.
      key={value}
      aria-label={label}
      defaultValue={value}
      placeholder={placeholder}
      maxLength={NAME_MOST}
      className="h-9 w-56"
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit(event.currentTarget.value)
      }}
    />
  )
}

/**
 * A field of `hosts.toml`'s entry, as main writes it: on Enter, or as it
 * loses the focus unless `enterOnly`, where it goes back to what the
 * entry has, as a half-typed address would be connected to at once.
 * Unless `empty`, an empty one is not written and the field goes back.
 */
function EntryField({
  label,
  value,
  placeholder,
  empty,
  enterOnly,
  onCommit,
}: {
  label: string
  value: string
  placeholder?: string
  empty?: boolean
  enterOnly?: boolean
  onCommit: (text: string) => void
}) {
  const commit = (field: HTMLInputElement) => {
    const now = field.value.trim()
    if (now === "" && !empty) field.value = value
    else if (now !== value) onCommit(now)
  }
  return (
    <Input
      key={value}
      aria-label={label}
      defaultValue={value}
      placeholder={placeholder}
      title={value || undefined}
      spellCheck={false}
      className="h-8 w-64 font-mono text-meta"
      onBlur={(event) => {
        if (enterOnly) event.currentTarget.value = value
        else commit(event.currentTarget)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit(event.currentTarget)
      }}
    />
  )
}

/**
 * Another machine of `hosts.toml`, which opens in place: as a link names
 * it (`machines/<key>`), or as the Person opens it. Its name and icon,
 * and whether it stays awake on power, are written on it, through its
 * engine, and only while it is live: one sent while it is away would wait
 * for it, and the Person would not see it go.
 */
function HostRow({
  host,
  lit,
  run,
  others,
  claude,
}: {
  host: Shown
  lit?: string
  run?: SectionProps["run"]
  /** The other machines shown, this one's too, for the picker's grey. */
  others: readonly Named[]
  claude: ClaudeThere
}) {
  const kept = useContext(HostsContext)
  const { name: key, named, state, power } = host
  const { name } = named
  // Its battery, while it is live (ADR 0097, decision 7), and why it is
  // awake, with how many of its Agents' Turns run: under its Battery, or
  // as Awake where it has none.
  const battery = power?.battery
  const turns = useTurnsOn(key)
  const awake = powerRow(power, turns)
  // Opened or closed here, until a link names another row.
  const [toggled, setToggled] = useState<{ lit?: string; open: boolean }>()
  const open = toggled && toggled.lit === lit ? toggled.open : lit === key
  const { busy, doing, problem, ask } = useAsk()
  // What Test found, while the machine stays in the state it was in.
  const [tested, setTested] = useState<{ in: string; test: HostTest }>()
  const [removing, setRemoving] = useState(false)
  const live = state.state === "live"
  // Its entry as hosts.toml has it: as main last wrote it, until its
  // state says it (a machine connecting again keeps its last state).
  const inState = `${state.ssh}\n${state.banda ?? ""}`
  const [wrote, setWrote] = useState<{ was: string; entry: HostEntry }>()
  const entry =
    wrote?.was === inState
      ? wrote.entry
      : { ssh: state.ssh, banda: state.banda }
  const { ssh, banda } = entry
  const set = (change: { ssh?: string; banda?: string }) =>
    void ask(async () =>
      setWrote({ was: inState, entry: await device.hosts.set(key, change) })
    )
  // Only while it is live, and its engine with it: a write sent as it
  // goes would wait for it to come back. Whether it was written; else
  // why not, as `away` says it while it is not live.
  const writeThere = (
    field: "name" | "icon" | AwakeKey,
    value: string | boolean | null,
    away: string
  ) =>
    ask(async () => {
      const engine = kept.engine(key)
      if (
        kept.get().find((one) => one.name === key)?.state.state !== "live" ||
        engine.status.state !== "open"
      )
        throw new Told(away)
      await write(engine, field, value)
      return true
    })
  const rename = (field: "name" | "icon", value: string | null) =>
    void writeThere(field, value, renameWords(name))
  const test = () =>
    void ask(async () => {
      setTested(undefined)
      const test = await device.hosts.test(ssh, banda ?? null)
      setTested({ in: state.state, test })
    }, `Testing ${name}…`)
  const remove = () => {
    setRemoving(false)
    void ask(async () => {
      await device.hosts.remove(key)
      forgetNamed(key)
    })
  }
  const build = buildWords(state)
  const why =
    state.state === "away" || state.state === "refused" ? state.why : undefined
  // Whether Claude is signed in there, as its Harness says, read while
  // the row is open and the machine live: reading starts it there.
  const [round, setRound] = useState(0)
  const account = useAccount(
    kept.engine(key),
    open && live ? CLAUDE : undefined,
    round
  )
  const signedOut =
    open &&
    live &&
    account.state === "ready" &&
    account.view.account.signed_in_as?.signed_in === false
  const shownTest = tested?.in === state.state ? tested.test : undefined
  const words = shownTest && testWords(shownTest, name)
  const found = shownTest && foundNamed(shownTest, name)
  return (
    <div data-key={key} className="flex flex-col border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setToggled({ lit, open: !open })}
        className={cn(
          "flex min-h-11 items-center gap-2 px-(--card-spacing) text-left text-ui hover:bg-accent/40",
          lit === key && "bg-accent/60"
        )}
      >
        {open ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <MachineMark
          named={named}
          form="full"
          className="text-ui text-foreground [&_svg]:text-muted-foreground"
        />
        {ssh !== name && (
          <span className="min-w-0 truncate font-mono text-meta text-muted-foreground">
            {ssh}
          </span>
        )}
        <span
          className="ml-auto flex shrink-0 items-center gap-1.5 text-meta text-muted-foreground tabular-nums"
          title={why}
        >
          {battery && <BatteryIcon battery={battery} />}
          <span>
            {battery && `${battery.percent}% · `}
            {stateWords(state)}
          </span>
        </span>
      </button>
      {open && (
        <div className="flex flex-col pb-1 pl-6">
          {why && (
            <p className="px-4 pt-1 pb-2 text-meta text-muted-foreground">
              {name}: {why}
            </p>
          )}
          {state.state === "signin" && (
            <p className="px-4 pt-1 pb-2 text-meta">
              <SignIn url={state.url}>
                Sign in to Tailscale to reach {name}
              </SignIn>
            </p>
          )}
          <div className="flex flex-col divide-y">
            <RowFrame
              dataKey={`${key}.named`}
              title="Name and icon"
              about={
                live
                  ? `Set on ${name}, in its machine.toml. Every window shows it the same.`
                  : `${renameWords(name)}.`
              }
            >
              <span className="flex items-center gap-2">
                <MachineMark named={named} form="full" />
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!live || busy}
                        title={live ? undefined : renameWords(name)}
                      />
                    }
                  >
                    Edit
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64">
                    <MachinePicker
                      named={named}
                      about={
                        live
                          ? `Written on ${name}, for every window.`
                          : `${renameWords(name)}.`
                      }
                      taken={takenBy(others)}
                      project={host.projects.at(0)}
                      disabled={!live}
                      onName={(text) => rename("name", nameOf(text))}
                      onIcon={(icon) => rename("icon", icon)}
                    />
                  </PopoverContent>
                </Popover>
              </span>
            </RowFrame>
            {awake && (
              <RowFrame
                dataKey={`${key}.${awake.key}`}
                title={awake.title}
                about={awake.about}
              >
                {battery && (
                  <span className="flex items-center gap-1.5 text-ui tabular-nums">
                    <BatteryIcon battery={battery} />
                    {batteryWords(battery)}
                  </span>
                )}
              </RowFrame>
            )}
            <PluggedIn
              host={key}
              name={name}
              live={live}
              busy={busy}
              onTurn={(on) =>
                writeThere(
                  "awake-plugged-in",
                  awakeValue("awake-plugged-in", on),
                  awayWords(name)
                )
              }
            />
            <UpdatesRow
              host={key}
              named={named}
              engine={kept.engine(key)}
              live={live}
              lit={lit === `${key}.updates`}
            />
            <RowFrame
              dataKey={`${key}.ssh`}
              title="Address"
              about="The ssh destination. Enter saves it, and a change reconnects it."
            >
              <EntryField
                label={`${name}'s address`}
                value={ssh}
                enterOnly
                onCommit={(text) => set({ ssh: text })}
              />
            </RowFrame>
            <RowFrame
              dataKey={`${key}.banda`}
              title={`Banda on ${name}`}
              about="Empty: Banda finds its own there."
            >
              <EntryField
                label={`Banda on ${name}`}
                value={banda ?? ""}
                placeholder="its own"
                empty
                onCommit={(text) => set({ banda: text })}
              />
            </RowFrame>
            {signedOut && (
              <RowFrame
                dataKey={`${key}.claude`}
                title="Claude"
                about={`Not signed in on ${name}: its Agents cannot start there.`}
              >
                <SignInClaude
                  claude={claude}
                  ssh={ssh}
                  name={name}
                  onCheck={() => setRound((now) => now + 1)}
                />
              </RowFrame>
            )}
            {build && (
              <RowFrame dataKey={`${key}.build`} title="Build">
                <span className="text-meta text-muted-foreground tabular-nums">
                  {build}
                </span>
              </RowFrame>
            )}
            <div className="flex flex-wrap items-center gap-1 px-2.5 py-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={test}>
                <PlugZapIcon />
                Test connection
              </Button>
              {run && (live || state.state === "refused") && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run("hosts.stop", { name: key })}
                >
                  <PowerIcon />
                  Stop Banda on {name}
                </Button>
              )}
              {state.state === "stopped" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => kept.start(key)}
                >
                  <PlayIcon />
                  Start Banda on {name}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => setRemoving(true)}
              >
                Remove…
              </Button>
            </div>
          </div>
          {doing && !shownTest && (
            <p className="flex items-center gap-2 px-4 pb-2 text-meta text-muted-foreground">
              <Spinner className="size-3" />
              {doing}
            </p>
          )}
          {words && shownTest && (
            <TestFound
              test={shownTest}
              words={words}
              icon={found?.icon}
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => setTested(undefined)}
                >
                  Close
                </Button>
              }
            />
          )}
          {problem && (
            <p role="alert" className="px-4 pb-2 text-meta text-destructive">
              {problem}
            </p>
          )}
        </div>
      )}
      <Dialog
        open={removing}
        onOpenChange={(now) => !now && setRemoving(false)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remove {name}?</DialogTitle>
            <DialogDescription>Its Projects stay on {name}.</DialogDescription>
          </DialogHeader>
          <p className="text-ui text-muted-foreground">
            This window stops showing its Projects and Threads, and Banda goes
            on running there. Add it again to see them.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove}>
              Remove {name}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * "Stay awake while plugged in" in another machine's row (ADR 0097,
 * decision 2): as that machine's `machines.get` says, asked as the row
 * opens while it is live, and turned through `onTurn`, which writes it
 * there. While the machine is not live, it is off, greyed, and takes no
 * click; while the row's acts run, it takes none either, yet keeps the
 * focus.
 */
function PluggedIn({
  host,
  name,
  live,
  busy,
  onTurn,
}: {
  /** Its key in `hosts.toml`. */
  host: string
  name: string
  live: boolean
  busy: boolean
  /** Whether it was written. */
  onTurn: (on: boolean) => Promise<boolean | undefined>
}) {
  const kept = useContext(HostsContext)
  const read = useMemo(
    () => (live ? () => kept.engine(host).call("machines.get", {}) : null),
    [kept, host, live]
  )
  const naming = useRead(read)
  const answer =
    naming.state === "ready"
      ? naming.value
      : naming.state === "refused"
        ? null
        : undefined
  // What the Person last set it to, over the answer it was set against:
  // one read again, as the machine is back, says it afresh.
  const [wrote, setWrote] = useState<Wrote>()
  const there = pluggedInThere(name, live, answer)
  const title = "Stay awake while plugged in"
  const on = there.can && shownOn(there.on, answer, wrote)
  const turn = (next: boolean) =>
    void onTurn(next).then(
      (done) => done && setWrote({ to: answer, was: there.on, on: next })
    )
  return (
    <RowFrame
      dataKey={`${host}.awake-plugged-in`}
      title={title}
      about={there.about}
    >
      {there.can ? (
        <BusySwitch
          label={`${title} on ${name}`}
          on={on}
          busy={busy}
          onChange={turn}
        />
      ) : (
        <Switch label={`${title} on ${name}`} on={on} disabled />
      )}
    </RowFrame>
  )
}

/** Tailscale's sign-in at `url`, which opens in the system's browser, as
 * every link of the page. */
function SignIn({ url, children }: { url: string; children: ReactNode }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-ring underline-offset-3 hover:underline"
    >
      {children}
    </a>
  )
}

/** What a Test or Connect found, or why not, with Tailscale's sign-in. */
function TestFound({
  test,
  words,
  icon,
  actions,
  children,
}: {
  test: HostTest
  words: ReturnType<typeof testWords>
  icon?: Icon
  /** Its buttons, on its right. */
  actions?: ReactNode
  /** More lines under what it found. */
  children?: ReactNode
}) {
  return (
    <div
      role="status"
      className={cn(
        "mx-2.5 mb-2 flex items-start gap-3 rounded-control bg-muted/50 px-3 py-2.5 text-ui",
        !words.found && "text-muted-foreground"
      )}
    >
      {words.found && (
        <MachineIcon
          icon={icon ?? "desktop"}
          size={20}
          className="mt-0.5 text-muted-foreground"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className={cn(words.found && "font-medium")}>
          {test.state === "signin" ? (
            <SignIn url={test.url}>{words.title}</SignIn>
          ) : (
            words.title
          )}
        </div>
        {words.detail && (
          <div className="text-meta text-muted-foreground">{words.detail}</div>
        )}
        {children}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-1.5 self-center">
          {actions}
        </div>
      )}
    </div>
  )
}

/**
 * Waits for the first welcome of machine `key`'s `engine`, then numbers
 * its name and moves its icon past the machines `shown` then, and writes
 * what changed on it, in its machine.toml (ADR 0095, decision 3). It goes
 * on if Settings closes meanwhile; what it wrote, or why that was not
 * written (`failed`), as it never throws; nothing for an engine that
 * names itself nothing.
 */
async function settleAdded(
  engine: Engine,
  key: string,
  shown: () => readonly Named[]
): Promise<{ settled: Settled; failed?: string } | undefined> {
  const said = await new Promise<unknown>((done) => {
    let heard = false
    let stop: (() => void) | undefined = undefined
    stop = engine.watch((status) => {
      if (heard || status.state !== "open") return
      heard = true
      done(status.named)
      stop?.()
    })
    // `watch` tells the status at once: an engine open already.
    if (heard) stop()
  })
  if (!said) return undefined
  const settled = settle(cleanNamed(said, key), shown())
  try {
    if (settled.sameName !== undefined)
      await write(engine, "name", settled.named.name)
    if (settled.sameIcon !== undefined)
      await write(engine, "icon", settled.named.icon)
    return { settled }
  } catch (error) {
    return { settled, failed: failedWords(error) }
  }
}

/** Install running on machine `name`: each step its `install.sh` said
 * so far, in words, the last with a spinner, and Cancel. */
function Installing({
  name,
  lines,
  cancel,
}: {
  name: string
  lines: readonly string[]
  cancel: () => void
}) {
  const steps = installSteps(lines, name)
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-control bg-muted/50 px-3 py-2.5 text-ui"
    >
      <MachineIcon
        icon="server"
        size={20}
        className="mt-0.5 text-muted-foreground"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="font-medium">Installing Banda on {name}</div>
        {steps.length === 0 && (
          <div className="flex items-center gap-2 text-meta text-muted-foreground">
            <Spinner className="size-3" />
            Reaching {name}
          </div>
        )}
        {steps.map((step) => (
          <div
            key={step.words}
            className={cn(
              "flex items-center gap-2 text-meta",
              step.done ? "text-muted-foreground" : "text-foreground"
            )}
          >
            {step.done ? (
              <CheckIcon className="size-3" />
            ) : (
              <Spinner className="size-3" />
            )}
            {step.words}
          </div>
        ))}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="self-center"
        onClick={cancel}
      >
        Cancel
      </Button>
    </div>
  )
}

/**
 * Add a machine: the Hosts of `~/.ssh/config` as chips, an address, and
 * Connect, which finds what is there and starts nothing; then Add, which
 * writes it in `hosts.toml` by a key made from the address. The Person
 * types no name: the machine has its own.
 */
function AddMachine({
  here,
  hosts,
  shown,
  claude,
}: {
  /** This machine's name and icon now. */
  here: Named | undefined
  hosts: readonly Shown[]
  /** The machines shown now, this one first, but machine `except`, as
   * Add settles against. */
  shown: (except?: string) => readonly Named[]
  claude: ClaudeThere
}) {
  const kept = useContext(HostsContext)
  const reached = hosts.map((one) => one.state.ssh).join(" ")
  // Read again as a machine comes or goes: none reached is suggested.
  const suggest = useCallback(
    () =>
      device.hosts
        .suggestions()
        .then((all) => all.filter((one) => !reached.split(" ").includes(one))),
    [reached]
  )
  const suggested = useRead(suggest)
  const [address, setAddress] = useState("")
  const [found, setFound] = useState<{ address: string; test: HostTest }>()
  const [added, setAdded] = useState<{
    name: string
    settled?: Settled
    failed?: string
  }>()
  // The machine Install set up and Add added, by its address: what its
  // Agents need there is offered next.
  const [installed, setInstalled] = useState<{ ssh: string; name: string }>()
  const { busy, doing, problem, ask } = useAsk()
  // One at a time: a second's answer could come before the first's.
  const connect = (to: string) => {
    const ssh = to.trim()
    if (!ssh || busy) return
    setAdded(undefined)
    setInstalled(undefined)
    void ask(async () => {
      setFound(undefined)
      setFound({ address: ssh, test: await device.hosts.test(ssh, null) })
    }, `Looking at ${ssh}…`)
  }
  const named = found && foundNamed(found.test, found.address)
  const words = found && testWords(found.test, found.address)
  // A machine at that address shows already: main would refuse it.
  const already = found && hosts.find((one) => one.state.ssh === found.address)
  const settled =
    named && !already ? settle(named, shownBeside(here, hosts)) : undefined
  // By the name Connect found, until it answers with its own.
  const addAt = async (ssh: string, name: string | undefined) => {
    const entry = await device.hosts.add({ ssh })
    setFound(undefined)
    setAddress("")
    setAdded({ name: name ?? entry.name })
    // Written on it once it answers, whether Settings is open then or
    // not; what was written, or why not, shows while it is.
    void settleAdded(kept.engine(entry.name), entry.name, () =>
      shown(entry.name)
    ).then((done) => done && setAdded({ name: name ?? entry.name, ...done }))
  }
  const add = () => {
    if (!found) return
    const ssh = found.address
    const name = named?.name
    void ask(() => addAt(ssh, name), "Adding…")
  }
  // Install, where Connect found no Banda (ADR 0119, decision 8): the
  // machine downloads it and puts it in place, saying each step; then
  // Connect again, and Add, which starts its engine.
  const [installing, setInstalling] = useState<{
    address: string
    lines: string[]
  }>()
  const install = () => {
    if (!found || busy) return
    const ssh = found.address
    setAdded(undefined)
    setInstalled(undefined)
    setInstalling({ address: ssh, lines: [] })
    void ask(async () => {
      try {
        await device.hosts.install(ssh, (line) =>
          setInstalling((now) =>
            now?.address === ssh
              ? { address: ssh, lines: [...now.lines, line] }
              : now
          )
        )
        const test = await device.hosts.test(ssh, null)
        setFound({ address: ssh, test })
        if (test.state === "found") {
          const name = foundNamed(test, ssh)?.name
          await addAt(ssh, name)
          setInstalled({ ssh, name: name ?? ssh })
        }
      } finally {
        setInstalling(undefined)
      }
    }, `Installing Banda on ${ssh}…`)
  }
  const chips = suggested.state === "ready" ? suggested.value : []
  return (
    <div className="flex flex-col gap-2.5 border-t px-(--card-spacing) pt-3 pb-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-ui font-medium">Add a machine</span>
        <span className="text-meta text-muted-foreground">
          Banda reads its name and icon.
        </span>
      </div>
      {chips.length > 0 && (
        <div
          role="group"
          aria-label="From ~/.ssh/config"
          className="flex flex-wrap items-center gap-1.5 text-meta text-muted-foreground"
        >
          From ~/.ssh/config:
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              aria-pressed={address === chip}
              disabled={busy}
              onClick={() => {
                setAddress(chip)
                connect(chip)
              }}
              className={cn(
                "rounded-control border px-2 py-0.5 font-mono text-meta text-foreground hover:bg-accent disabled:opacity-50",
                address === chip && "border-ring"
              )}
            >
              {chip}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          connect(address)
        }}
      >
        <Input
          aria-label="Address of the machine to add"
          placeholder="user@machine"
          value={address}
          spellCheck={false}
          className="h-8 flex-1 font-mono text-meta"
          onChange={(event) => {
            // What Connect found is of the address it looked at.
            setAddress(event.target.value)
            setFound(undefined)
          }}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={busy || !address.trim()}
        >
          Connect
        </Button>
      </form>
      {doing && !installing && (
        <p className="flex items-center gap-2 text-meta text-muted-foreground">
          <Spinner className="size-3" />
          {doing}
        </p>
      )}
      {installing && (
        <Installing
          name={installing.address}
          lines={installing.lines}
          cancel={() => void device.hosts.cancelInstall(installing.address)}
        />
      )}
      {found && words && !installing && (
        <div className="-mx-2.5">
          <TestFound
            test={found.test}
            words={words}
            icon={
              settled?.named.icon ??
              named?.icon ??
              (found.test.state === "missing" ? "server" : undefined)
            }
            actions={
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFound(undefined)}
                >
                  Cancel
                </Button>
                {found.test.state === "missing" ? (
                  <Button size="sm" disabled={busy} onClick={install}>
                    Install Banda on {found.address}
                  </Button>
                ) : (
                  words.found &&
                  !already && (
                    <Button size="sm" disabled={busy} onClick={add}>
                      Add
                    </Button>
                  )
                )}
              </>
            }
          >
            {already && (
              <div className="text-meta text-muted-foreground">
                {already.named.name} is added already.
              </div>
            )}
            {settled &&
              settleWords(settled).map((line) => (
                <div key={line} className="text-meta text-muted-foreground">
                  {line}
                </div>
              ))}
          </TestFound>
        </div>
      )}
      {added && (
        <p role="status" className="text-meta text-muted-foreground">
          {addedWords(added.name, added.settled, added.failed)}
        </p>
      )}
      {installed && (
        <SignInClaude
          claude={claude}
          ssh={installed.ssh}
          name={added?.settled?.named.name ?? installed.name}
        />
      )}
      {problem && (
        <p role="alert" className="text-meta text-destructive">
          {problem}
        </p>
      )}
    </div>
  )
}
