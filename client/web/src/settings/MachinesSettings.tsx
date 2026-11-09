/**
 * Settings → Machines (ADR 0095, decision 9): this machine's name and
 * icon, which its own engine writes in its `machine.toml`, and when it
 * stays awake (ADR 0097); each other machine of `hosts.toml`, whose row
 * opens in place, its name and icon and whether it stays awake on power
 * written on that machine through its engine while it is live, its
 * address and its `banda` written in `hosts.toml` through the desktop;
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
import type { Engine } from "@banda/contract"
import type { MachineIcon as Icon, Named } from "@banda/contract/machines"
import { tomlOf } from "@banda/contract/settings"
import { Button } from "@banda/ui/components/button"
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
import { useProjects } from "@banda/ui/hooks/use-projects"
import { useRead } from "@banda/ui/hooks/use-read"
import {
  cleanNamed,
  forgetNamed,
  useNamed,
  useStatus,
} from "@banda/ui/hooks/use-status"
import { shownProjects } from "@banda/ui/lib/projects"
import { cn } from "@banda/ui/lib/utils"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  LaptopIcon,
  PlayIcon,
  PlugZapIcon,
  PowerIcon,
  Undo2Icon,
} from "lucide-react"
import {
  type HostEntry,
  HostsContext,
  type HostTest,
  type Shown,
  useHosts,
} from "@banda/core/react"
import { device } from "../boot"
import { useLookSettings } from "../look"
import { MachinePicker } from "./MachinePicker"
import {
  addedWords,
  AWAKE_ROWS,
  type AwakeKey,
  awakeOn,
  awakeValue,
  awayWords,
  buildWords,
  ended,
  factsWords,
  failedWords,
  foundNamed,
  lidWords,
  NAME_MOST,
  NO_ACTS,
  pluggedInThere,
  renameWords,
  type Settled,
  settle,
  settleWords,
  shownActs,
  shownOn,
  started,
  stateWords,
  testWords,
  Told,
  type Wrote,
} from "./machines"
import type { SectionProps } from "./sections"
import { RowFrame } from "./SettingRow"

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
  const here = useNamed(engine)
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
            <p className="px-(--card-spacing) py-3 text-sm text-muted-foreground">
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
            />
          ))}
          <AddMachine here={here} hosts={hosts} shown={shown} />
        </CardContent>
      </Card>
    </>
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
  // What the Person last set each switch to, until the look hears it.
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
    const was = awakeOn(key, keyed, got)
    void ask(async () => {
      await write(engine, key, awakeValue(key, on))
      setWrote((now) => ({ ...now, [key]: { was, on } }))
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
          <div className="ml-auto text-right text-xs leading-5 text-muted-foreground">
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
            on={shownOn(awakeOn(key, keyed, got), wrote[key])}
            onChange={busy ? undefined : (on) => turn(key, on)}
            className="border-t px-(--card-spacing) py-3 last:pb-0"
          />
        ))}
        {got?.battery === true && (
          <p className="flex items-center gap-2 border-t px-(--card-spacing) pt-2.5 text-xs text-muted-foreground">
            <LaptopIcon className="size-3.5 shrink-0" />
            {lidWords(now.name, got.system)}
          </p>
        )}
        {problem && (
          <p
            role="alert"
            className="px-(--card-spacing) pt-2 text-xs text-destructive"
          >
            {problem}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** A setting of a machine.toml as a switch, with what it does; one with no
 * `onChange` is greyed and takes no click, as while a write runs. */
function SwitchRow({
  dataKey,
  title,
  about,
  on,
  onChange,
  className,
}: {
  dataKey: string
  title: string
  about: string
  on: boolean
  onChange?: (on: boolean) => void
  className?: string
}) {
  return (
    <div
      data-key={dataKey}
      className={cn("flex items-center gap-3", className)}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{about}</div>
      </div>
      {onChange ? (
        <Switch label={title} on={on} onChange={onChange} />
      ) : (
        <Switch label={title} on={on} disabled />
      )}
    </div>
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
      className="h-8 w-64 font-mono text-xs"
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
}: {
  host: Shown
  lit?: string
  run?: SectionProps["run"]
  /** The other machines shown, this one's too, for the picker's grey. */
  others: readonly Named[]
}) {
  const kept = useContext(HostsContext)
  const { name: key, named, state } = host
  const { name } = named
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
          "flex min-h-11 items-center gap-2 px-(--card-spacing) text-left text-sm hover:bg-accent/40",
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
          className="text-sm text-foreground [&_svg]:text-muted-foreground"
        />
        {ssh !== name && (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {ssh}
          </span>
        )}
        <span
          className="ml-auto shrink-0 text-xs text-muted-foreground"
          title={why}
        >
          {stateWords(state)}
        </span>
      </button>
      {open && (
        <div className="flex flex-col pb-1 pl-6">
          {why && (
            <p className="px-4 pt-1 pb-2 text-xs text-muted-foreground">
              {name}: {why}
            </p>
          )}
          {state.state === "signin" && (
            <p className="px-4 pt-1 pb-2 text-xs">
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
            {build && (
              <RowFrame dataKey={`${key}.build`} title="Build">
                <span className="text-xs text-muted-foreground tabular-nums">
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
            <p className="flex items-center gap-2 px-4 pb-2 text-xs text-muted-foreground">
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
            <p role="alert" className="px-4 pb-2 text-xs text-destructive">
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
          <p className="text-sm text-muted-foreground">
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
 * there. While the machine is not live, or a write runs, it takes no
 * click; while it is not live, it is off.
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
  const [wrote, setWrote] = useState<{ to: unknown; wrote: Wrote }>()
  const there = pluggedInThere(name, live, answer)
  const title = "Stay awake while plugged in"
  const on =
    there.can &&
    shownOn(there.on, wrote && wrote.to === answer ? wrote.wrote : undefined)
  const turn = (next: boolean) =>
    void onTurn(next).then(
      (done) =>
        done && setWrote({ to: answer, wrote: { was: there.on, on: next } })
    )
  return (
    <RowFrame
      dataKey={`${host}.awake-plugged-in`}
      title={title}
      about={there.about}
    >
      {there.can && !busy ? (
        <Switch label={title} on={on} onChange={turn} />
      ) : (
        <Switch label={title} on={on} disabled />
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
        "mx-2.5 mb-2 flex items-start gap-3 rounded-lg bg-muted/50 px-3 py-2.5 text-sm",
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
          <div className="text-xs text-muted-foreground">{words.detail}</div>
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
}: {
  /** This machine's name and icon now. */
  here: Named | undefined
  hosts: readonly Shown[]
  /** The machines shown now, this one first, but machine `except`, as
   * Add settles against. */
  shown: (except?: string) => readonly Named[]
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
  const { busy, doing, problem, ask } = useAsk()
  // One at a time: a second's answer could come before the first's.
  const connect = (to: string) => {
    const ssh = to.trim()
    if (!ssh || busy) return
    setAdded(undefined)
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
  const add = () => {
    if (!found) return
    const ssh = found.address
    // By the name Connect found, until it answers with its own.
    const name = named?.name
    void ask(async () => {
      const entry = await device.hosts.add({ ssh })
      setFound(undefined)
      setAddress("")
      setAdded({ name: name ?? entry.name })
      // Written on it once it answers, whether Settings is open then or
      // not; what was written, or why not, shows while it is.
      void settleAdded(kept.engine(entry.name), entry.name, () =>
        shown(entry.name)
      ).then((done) => done && setAdded({ name: name ?? entry.name, ...done }))
    }, "Adding…")
  }
  const chips = suggested.state === "ready" ? suggested.value : []
  return (
    <div className="flex flex-col gap-2.5 border-t px-(--card-spacing) pt-3 pb-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium">Add a machine</span>
        <span className="text-xs text-muted-foreground">
          Banda reads its name and icon.
        </span>
      </div>
      {chips.length > 0 && (
        <div
          role="group"
          aria-label="From ~/.ssh/config"
          className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
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
                "rounded-md border px-2 py-0.5 font-mono text-xs text-foreground hover:bg-accent disabled:opacity-50",
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
          className="h-8 flex-1 font-mono text-xs"
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
      {doing && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3" />
          {doing}
        </p>
      )}
      {found && words && (
        <div className="-mx-2.5">
          <TestFound
            test={found.test}
            words={words}
            icon={settled?.named.icon ?? named?.icon}
            actions={
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFound(undefined)}
                >
                  Cancel
                </Button>
                {words.found && !already && (
                  <Button size="sm" disabled={busy} onClick={add}>
                    Add
                  </Button>
                )}
              </>
            }
          >
            {already && (
              <div className="text-xs text-muted-foreground">
                {already.named.name} is added already.
              </div>
            )}
            {settled &&
              settleWords(settled).map((line) => (
                <div key={line} className="text-xs text-muted-foreground">
                  {line}
                </div>
              ))}
          </TestFound>
        </div>
      )}
      {added && (
        <p role="status" className="text-xs text-muted-foreground">
          {addedWords(added.name, added.settled, added.failed)}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  )
}
