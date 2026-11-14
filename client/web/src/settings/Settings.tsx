/**
 * Settings (ADR 0016): the sections and a search on the left, the section's
 * rows in cards on the right, as in the mockup Roma approved
 * (docs/adr/0016-settings-window.html). It keeps no setting of its own:
 * every value is the look's, as `banda look --follow` read the files.
 */
import { useContext, useEffect, useMemo, useRef, useState } from "react"
import type { Owner } from "@banda/core"
import type { Problem } from "@banda/contract/look"
import { aboutOf, type Row, SCHEMAS } from "@banda/contract/settings"
import { Button } from "@banda/ui/components/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@banda/ui/components/input-group"
import { PaneHeader } from "@banda/ui/components/pane-header"
import { ScrollArea } from "@banda/ui/components/scroll-area"
import { cn } from "@banda/ui/lib/utils"
import {
  HostsContext,
  useAnyHost,
  useHosts,
  useShownOf,
} from "@banda/core/react"
import { copyText } from "@banda/ui/lib/clipboard"
import { THIS_COMPUTER } from "@banda/ui/lib/outside"
import type { PaneProps } from "@banda/ui/pane"
import { useScope } from "@banda/ui/hooks/use-scope"
import { useMachine } from "@banda/ui/hooks/use-status"
import { CopyIcon, ExternalLinkIcon, SearchIcon } from "lucide-react"
import { problemWords } from "../bar/problems/Problems"
import { useLookProblems, useLookSettings } from "../look"
import {
  groupsOf,
  ownFile,
  parseLink,
  search,
  type Section,
  SECTIONS,
  switches,
} from "./sections"
import type { SettingsArgs } from "./pane"
import { Group, Rows, SettingRow } from "./SettingRow"
import { SettingsFor } from "./SettingsFor"
import { usePaneHandles } from "../tiling/mount"
import { MachinePill } from "../window/named"
import { classOf, throughEngine, useMachineSettings } from "./machine-settings"
import { device } from "../boot"

const NONE: Problem[] = []

export function Settings({
  engine,
  args,
  update,
  close,
  run,
}: PaneProps<SettingsArgs>) {
  // Where it is lives in its args, so it comes back there.
  const at = useMemo(() => parseLink(args.link), [args.link])
  const [words, setWords] = useState("")
  const field = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const keyed = useLookSettings()
  const problems = useLookProblems()

  // A link's row comes into view, lit: in these settings alone.
  useEffect(() => {
    if (!at.key) return
    root.current
      ?.querySelector(`[data-key="${CSS.escape(at.key)}"]`)
      ?.scrollIntoView({ block: "center" })
  }, [at])
  // While the Pane has the focus, / searches (`settings.search`, ADR
  // 0071), but in a field; Esc in the search clears it, and only then
  // takes the Sheet away.
  const scope = useScope(
    "settings",
    {
      "settings.search": (_, event) => {
        if (event?.target instanceof HTMLInputElement) return false
        field.current?.focus()
        return true
      },
    },
    { tile: true }
  )

  // What is wrong in each settings file, and at which of its lines.
  const wrong = useMemo(() => {
    const byFile = new Map<string, Problem[]>()
    for (const problem of problems) {
      const file = nameOf(problem.path)
      if (SCHEMAS[file])
        byFile.set(file, [...(byFile.get(file) ?? []), problem])
    }
    return byFile
  }, [problems])
  const first = [...wrong.values()][0]?.[0]

  const section = at.section
  const others = useAnyHost()
  // Whose parts it shows (ADR 0106, step 5b): in a section with a part of
  // the machine's, a file's or what its engine keeps, the machine picked,
  // by its engine; the rest is this device's, as the look reads it.
  // Machines shows every machine itself.
  const kept = useContext(HostsContext)
  const hosts = useHosts()
  const fileNames = (section.files ?? []).map((file) => file.name)
  const switching = hosts.length > 0 && switches(section)
  const on =
    switching && hosts.some((host) => host.name === args.on)
      ? args.on
      : undefined
  const shownOn = useShownOf(on)
  const machineEngine = useMemo(
    () => (on === undefined ? engine : kept.engine(on)),
    [on, engine, kept]
  )
  // What a section runs, it runs for the machine it shows, by that
  // machine's Host scope's ID once its engine said it (ADR 0106, law 3):
  // the router places it there, or says why not.
  const shownMachine = useMachine(machineEngine)
  const owner = useMemo<Owner>(
    () => (shownMachine ? { machine: shownMachine } : "window"),
    [shownMachine]
  )
  const acts = usePaneHandles(owner, run)
  const body = {
    engine: machineEngine,
    on,
    there: on === undefined ? undefined : (shownOn?.named.name ?? on),
    lit: at.key,
    run: acts.run,
    runs: acts.runs,
  }
  const machine = useMachineSettings(
    on === undefined ? undefined : machineEngine,
    fileNames
  )
  const machineWriter = useMemo(
    () => throughEngine(machineEngine),
    [machineEngine]
  )
  const theirs = (r: Row) =>
    on !== undefined && classOf(r.file, r.key) === "machine"
  const found = useMemo(
    () => (words.trim() ? search(words, others) : []),
    [words, others]
  )
  const go = (next: Section, key?: string) => {
    setWords("")
    const link = key ? `${next.id}/${key}` : next.id
    if (link !== args.link) update({ ...args, link })
  }
  // A problem shows at the row of its key; the rest, above the section.
  const row = (r: Row) => {
    const mine = theirs(r)
    const setting = mine
      ? machine.keyed[r.file]?.[r.key]
      : keyed[r.file]?.[r.key]
    const here = (mine ? machine.problems : (wrong.get(r.file) ?? NONE)).filter(
      (p) => p.key === r.key
    )
    return (
      <SettingRow
        key={`${r.file}:${r.key}`}
        row={r}
        setting={setting}
        lit={r.key === at.key}
        problems={here}
        Custom={section.custom?.[r.key]}
        writer={mine ? machineWriter : undefined}
        where={on !== undefined && !mine ? `on ${THIS_COMPUTER}` : undefined}
      />
    )
  }
  const sectionGroups = groupsOf(section)
  const shown = new Set(
    sectionGroups.flatMap((g) => g.rows.map((r) => `${r.file}:${r.key}`))
  )
  const groups = sectionGroups.map((group) => (
    <Group key={group.title} title={group.title}>
      {group.rows.map(row)}
    </Group>
  ))
  // A file the section names twice says its problems once; a Body says
  // those of what it draws at its own rows.
  const names = new Set(
    (section.files ?? []).filter((file) => !file.drawn).map((file) => file.name)
  )
  const above = [...names].flatMap((name) =>
    (wrong.get(name) ?? NONE).filter((p) => !shown.has(`${name}:${p.key}`))
  )
  const own = ownFile(section)

  // A Pane as wide as a column: in a narrow one, the sections are a row
  // of icons over the page; in a wide one, a list beside it.
  return (
    <div ref={scope} className="@container h-full text-foreground">
      <div ref={root} className="flex h-full flex-col @3xl:flex-row">
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 flex-col gap-0.5 border-b bg-sidebar/60 p-2 @3xl:w-56 @3xl:border-r @3xl:border-b-0"
        >
          <InputGroup className="mb-1 @3xl:mb-2">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              ref={field}
              value={words}
              onChange={(event) => setWords(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || !words) return
                // Its own: not the Sheet's, which the next one takes away.
                event.preventDefault()
                event.stopPropagation()
                setWords("")
              }}
              placeholder="Search settings"
              aria-label="Search settings"
            />
            <InputGroupAddon align="inline-end">
              <kbd className="text-small">/</kbd>
            </InputGroupAddon>
          </InputGroup>
          <div className="flex gap-0.5 overflow-x-auto @3xl:flex-col">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                title={s.title}
                aria-current={s === section && !words ? "page" : undefined}
                onClick={() => go(s)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-control px-2 py-1.5 text-left text-ui text-muted-foreground hover:bg-accent/60",
                  s === section && !words && "bg-accent text-foreground"
                )}
              >
                <s.icon className="size-4" />
                <span className="sr-only flex-1 @3xl:not-sr-only">
                  {s.title}
                </span>
                <span className="hidden font-mono text-meta opacity-70 @3xl:inline">
                  {ownFile(s)}
                </span>
              </button>
            ))}
          </div>
          <div
            className={cn(
              "mt-auto hidden items-center gap-2 px-2 pt-2 text-meta text-muted-foreground @3xl:flex",
              first && "text-attention"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                first ? "bg-attention" : "bg-primary"
              )}
            />
            {first
              ? `${nameOf(first.path)}${first.line ? `:${first.line}` : ""} is wrong`
              : "Every file reads"}
          </div>
        </nav>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PaneHeader
            title="Settings"
            onClose={close}
            className="gap-1.5 text-muted-foreground"
          >
            Settings <span>/</span>
            <b className="font-medium text-foreground">
              {words ? "Search" : section.title}
            </b>
          </PaneHeader>
          {switching && !words && (
            <SettingsFor
              hosts={hosts}
              on={on}
              onPick={(picked) => update({ link: args.link, on: picked })}
            />
          )}
          {shownOn && shownOn.state.state !== "live" && !words && (
            <div className="flex justify-center pt-2">
              <MachinePill
                shown={shownOn}
                onStart={() => kept.start(shownOn.name)}
              />
            </div>
          )}
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-6">
              {words ? (
                <Rows>
                  {found.length === 0 ? (
                    <p className="px-4 py-3 text-ui text-muted-foreground">
                      No setting says “{words.trim()}”.
                    </p>
                  ) : (
                    found.map(({ section: s, row: r }) => (
                      <button
                        key={`${s.id}:${r.key}`}
                        type="button"
                        className="flex w-full flex-col px-4 py-2 text-left hover:bg-accent/60"
                        onClick={() => go(s, r.key)}
                      >
                        <span className="text-ui">{r.title}</span>
                        <span className="text-meta text-muted-foreground">
                          {s.title} · {r.file} · {r.key}
                        </span>
                      </button>
                    ))
                  )}
                </Rows>
              ) : (
                <>
                  <div className="flex items-start gap-4">
                    <div className="flex-1">
                      <h1 className="text-heading font-semibold">
                        {section.title}
                      </h1>
                      <p className="text-ui text-muted-foreground">
                        {section.about}
                      </p>
                    </div>
                    {own && on === undefined && (
                      <OpenFile file={own} words="Open file" />
                    )}
                    {own && on !== undefined && machine.paths[own] && (
                      <ThereFile path={machine.paths[own]} on={shownOn} />
                    )}
                  </div>
                  {section.Body && (
                    // What it kept of one machine does not show as
                    // another's.
                    <section.Body key={on ?? ""} {...body} />
                  )}
                  {groups}
                  {section.Foot && <section.Foot {...body} />}
                  {above.length > 0 && (
                    <div
                      role="alert"
                      className="order-first rounded-control border border-destructive/40 px-4 py-2 text-meta text-destructive"
                    >
                      {above.map((p) => (
                        <p key={problemWords(p)}>{problemWords(p)}</p>
                      ))}
                    </div>
                  )}
                  {!section.files && !section.Body && <Files wrong={wrong} />}
                </>
              )}
            </div>
          </ScrollArea>
          <footer className="border-t px-4 py-2 text-meta text-muted-foreground">
            Changes apply as you make them, written to the file with its
            comments kept. Edit a file by hand and the settings follow.
          </footer>
        </main>
      </div>
    </div>
  )
}

function OpenFile({ file, words }: { file: string; words: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={() => device.settings.reveal(file)}
    >
      <ExternalLinkIcon />
      {words}
    </Button>
  )
}

/** Another machine's file, which this computer cannot open: where it is
 * there, to copy (ADR 0106, decision 7, call 18). */
function ThereFile({
  path,
  on,
}: {
  path: string
  on?: { named: { name: string } }
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="max-w-72 font-mono text-meta text-muted-foreground"
      title={`Copy where it is on ${on?.named.name ?? "that machine"}`}
      onClick={() => copyText(path)}
    >
      <span className="truncate">{path}</span>
      <CopyIcon />
    </Button>
  )
}

/** Every file, and whether it reads. */
function Files({ wrong }: { wrong: Map<string, Problem[]> }) {
  return (
    <Rows>
      {Object.keys(SCHEMAS).map((file) => {
        const first = wrong.get(file)?.[0]
        return (
          <div key={file} className="flex items-center gap-3 px-4 py-3">
            <span
              className={cn(
                "size-1.5 rounded-full",
                first ? "bg-destructive" : "bg-primary"
              )}
            />
            <div className="flex-1">
              <div className="font-mono text-ui">{file}</div>
              <div className="text-meta text-muted-foreground">
                {first ? problemWords(first) : aboutOf(file)}
              </div>
            </div>
            <OpenFile file={file} words="Open" />
          </div>
        )
      })}
    </Rows>
  )
}

/** A problem's file: `look.toml`. */
function nameOf(path: string): string {
  return path.split("/").pop() ?? path
}
