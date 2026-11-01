/**
 * Settings (ADR 0016): the sections and a search on the left, the section's
 * rows in cards on the right, as in the mockup Roma approved
 * (docs/adr/0016-settings-window.html). It keeps no setting of its own:
 * every value is the look's, as `banda look --follow` read the files.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import type { Engine } from "@banda/contract"
import type { Problem } from "@banda/contract/look"
import { aboutOf, type Row, SCHEMAS } from "@banda/contract/settings"
import { Button } from "@banda/ui/components/button"
import { Card } from "@banda/ui/components/card"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@banda/ui/components/input-group"
import { ScrollArea } from "@banda/ui/components/scroll-area"
import { cn } from "@banda/ui/lib/utils"
import { ExternalLinkIcon, SearchIcon, XIcon } from "lucide-react"
import { problemWords } from "../bar/Bar"
import { useLookProblems, useLookSettings } from "../look"
import { groupsOf, parseLink, search, type Section, SECTIONS } from "./sections"
import { SettingRow } from "./SettingRow"

const NONE: Problem[] = []

export function Settings({
  engine,
  link,
  onClose,
}: {
  engine: Engine
  /** Where it opens: a section and a row, `appearance/radius`. */
  link: string
  onClose: () => void
}) {
  const [at, setAt] = useState(() => parseLink(link))
  const [words, setWords] = useState("")
  const field = useRef<HTMLInputElement>(null)
  const keyed = useLookSettings()
  const problems = useLookProblems()

  useEffect(
    () => window.banda?.settings.listen((next) => setAt(parseLink(next))),
    []
  )
  // A link's row comes into view, lit.
  useEffect(() => {
    if (!at.key || !at.section.file) return
    document
      .getElementById(`row-${at.section.file}-${at.key}`)
      ?.scrollIntoView({ block: "center" })
  }, [at])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A dialog over the window takes its own keys, Esc first.
      if (
        event.target instanceof Element &&
        event.target.closest("[role=dialog]")
      )
        return
      const typing = event.target instanceof HTMLInputElement
      if (event.key === "Escape") {
        if (typing && field.current?.value) return setWords("")
        onClose()
      } else if (event.key === "/" && !typing) {
        event.preventDefault()
        field.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

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
  const found = useMemo(() => (words.trim() ? search(words) : []), [words])
  const go = (next: Section, key?: string) => {
    setWords("")
    setAt({ section: next, key })
  }
  // A problem at a line a row's value is on shows at that row; the rest,
  // above the section.
  const file = section.file ?? ""
  const atRows = new Set<number>()
  const row = (r: Row) => {
    const setting = keyed[r.file]?.[r.key]
    const line = setting?.from.layer === "file" ? setting.from.line : undefined
    if (line) atRows.add(line)
    const here = line
      ? (wrong.get(r.file) ?? NONE).filter((p) => p.line === line)
      : NONE
    return (
      <SettingRow
        key={`${r.file}:${r.key}`}
        row={r}
        setting={setting}
        lit={r.key === at.key}
        problems={here}
        Custom={section.custom?.[r.key]}
      />
    )
  }
  const groups = groupsOf(section).map((group) => (
    <div key={group.title} className="flex flex-col gap-1.5">
      {group.title && (
        <h2 className="px-1 text-xs font-medium text-muted-foreground">
          {group.title}
        </h2>
      )}
      <Rows>{group.rows.map(row)}</Rows>
    </div>
  ))
  const above = (wrong.get(file) ?? NONE).filter(
    (p) => !p.line || !atRows.has(p.line)
  )

  return (
    <div className="flex h-full bg-background text-foreground">
      <nav
        aria-label="Settings sections"
        className="flex w-56 shrink-0 flex-col gap-0.5 border-r bg-sidebar/60 p-2"
      >
        <InputGroup className="mb-2">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            ref={field}
            value={words}
            onChange={(event) => setWords(event.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
          />
          <InputGroupAddon align="inline-end">
            <kbd className="text-[10px]">/</kbd>
          </InputGroupAddon>
        </InputGroup>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-current={s === section && !words ? "page" : undefined}
            onClick={() => go(s)}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent/60",
              s === section && !words && "bg-accent text-foreground"
            )}
          >
            <s.icon className="size-4" />
            <span className="flex-1">{s.title}</span>
            {s.file && (
              <span className="font-mono text-[10px] opacity-70">{s.file}</span>
            )}
          </button>
        ))}
        <div
          className={cn(
            "mt-auto flex items-center gap-2 px-2 pt-2 text-xs text-muted-foreground",
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
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-1.5 border-b px-4 text-sm text-muted-foreground">
          Settings <span>/</span>
          <b className="font-medium text-foreground">
            {words ? "Search" : section.title}
          </b>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-muted-foreground"
            aria-label="Close settings"
            onClick={onClose}
          >
            <kbd className="text-[10px]">Esc</kbd>
            <XIcon />
          </Button>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-6">
            {words ? (
              <Rows>
                {found.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">
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
                      <span className="text-sm">{r.title}</span>
                      <span className="text-xs text-muted-foreground">
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
                    <h1 className="text-xl font-semibold">{section.title}</h1>
                    <p className="text-sm text-muted-foreground">
                      {section.about}
                    </p>
                  </div>
                  {section.file && (
                    <OpenFile file={section.file} words="Open file" />
                  )}
                </div>
                {section.Body ? (
                  <section.Body engine={engine} lit={at.key} />
                ) : section.file ? (
                  <>
                    {groups}
                    {above.length > 0 && (
                      <div
                        role="alert"
                        className="order-first rounded-lg border border-destructive/40 px-4 py-2 text-xs text-destructive"
                      >
                        {above.map((p) => (
                          <p key={problemWords(p)}>{problemWords(p)}</p>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <Files wrong={wrong} />
                )}
              </>
            )}
          </div>
        </ScrollArea>
        <footer className="border-t px-4 py-2 text-xs text-muted-foreground">
          Changes apply as you make them, written to the file with its comments
          kept. Edit a file by hand and this window follows.
        </footer>
      </main>
    </div>
  )
}

/** Rows in a card, a line between each. */
function Rows({ children }: { children: ReactNode }) {
  return <Card className="gap-0 divide-y py-0">{children}</Card>
}

function OpenFile({ file, words }: { file: string; words: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={() => void window.banda?.settings.reveal(file)}
    >
      <ExternalLinkIcon />
      {words}
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
              <div className="font-mono text-sm">{file}</div>
              <div className="text-xs text-muted-foreground">
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
