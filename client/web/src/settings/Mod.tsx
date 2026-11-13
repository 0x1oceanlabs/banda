/**
 * The mod (ADR 0068, decisions 1 and 5): the keys held for every Banda key
 * and the mouse's moves, Alt or one the desktop leaves free, with Banda's
 * keys as they read with it. A new mod moves the Person's lines that held
 * the old one, after showing them; a `none` of the old mod goes, as its
 * key is no longer Banda's. `banda settings` writes keys.toml and refuses
 * a mod that cannot be one, saying why.
 */
import { useState } from "react"
import { DEFAULT_KEYS, type Mod } from "@banda/contract/look"
import { tomlOf } from "@banda/contract/settings"
import { Button } from "@banda/ui/components/button"
import { Card } from "@banda/ui/components/card"
import { Kbd } from "@banda/ui/components/kbd"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { useWrite } from "@banda/ui/hooks/use-write"
import {
  isMac,
  keyLabel,
  keyText,
  modLabel,
  modText,
  sameMod,
} from "@banda/ui/lib/keys"
import { cn } from "@banda/ui/lib/utils"
import { bindPath, KEYS_FILE, type Move, movesOf } from "../actions/actions"
import { useLookKeys } from "../look"
import { device } from "../boot"

/** The mods Settings offers first, each with when it fits. */
const PICKS: readonly { mod: Mod; when: string }[] = [
  { mod: DEFAULT_KEYS.mod, when: "Banda's own" },
  {
    mod: { alt: true, ctrl: true, super: false },
    when: isMac ? "when the desktop holds ⌥" : "when the desktop holds Alt",
  },
  {
    mod: { alt: true, ctrl: false, super: true },
    when: isMac ? "when it holds ⌃⌥ too" : "when it holds Ctrl+Alt too",
  },
]

/** The keys a mod may hold, as Settings names them. */
const HELD = [
  { one: "ctrl", name: isMac ? "⌃ Control" : "Ctrl" },
  { one: "alt", name: isMac ? "⌥ Option" : "Alt" },
  { one: "super", name: isMac ? "⌘ Command" : "Super" },
] as const

/** Banda's keys Settings shows as they read with the mod, by action. */
const SHOWN = [
  ["column.next-width", "The column's next width"],
  ["column.maximize", "The column the whole screen wide"],
  ["column.wider", "The column wider"],
  ["workspace.go-1", "Go to workspace 1"],
  ["thread.new", "New Thread"],
  ["terminal.new", "New terminal"],
  ["menu.open", "Banda menu"],
  ["pane.close", "Close the Pane"],
] as const

export function ModCard() {
  const keys = useLookKeys()
  const now = keys.mod
  const keyFor = useKeyLabel()
  const settings = device.settings.writes() ? device.settings : undefined
  const { refused, write } = useWrite({ against: now })
  // A mod picked whose moves wait to be seen.
  const [asked, setAsked] = useState<{
    from: Mod
    mod: Mod
    moves: Move[]
  }>()
  // The keys to pick one by one show for a mod of the Person's own.
  const [owning, setOwning] = useState(false)
  const own = owning || !PICKS.some((pick) => sameMod(pick.mod, now))

  // The mod is written first, so one that cannot be one is refused at
  // once; then the lines that held the old one are shown, to move.
  const pick = (mod: Mod) => {
    if (sameMod(mod, now) || !settings) return
    const moves = movesOf(keys.binds, now, mod)
    const answer = sameMod(mod, DEFAULT_KEYS.mod)
      ? settings.reset(KEYS_FILE, "mod")
      : settings.set(KEYS_FILE, "mod", tomlOf(modText(mod)))
    write(answer)
    void answer.then((wrong) => {
      if (wrong.length > 0) return
      setAsked(moves.length > 0 ? { from: now, mod, moves } : undefined)
    })
  }
  // The moves stay shown until they are written, or what refused them.
  const move = (moves: readonly Move[]) => {
    if (!settings) return
    const answer = (async () => {
      for (const { bind, to } of moves) {
        const path = bindPath(bind)
        const wrong = to
          ? await settings.rename(KEYS_FILE, path, keyText(to))
          : await settings.reset(KEYS_FILE, path)
        if (wrong.length > 0) return wrong
      }
      return []
    })()
    write(answer)
    void answer.then((wrong) => {
      if (wrong.length === 0) setAsked(undefined)
    })
  }

  return (
    <Card className="gap-3 px-4 py-3">
      <div>
        <h3 className="text-ui font-medium">Main key</h3>
        <p className="text-meta text-muted-foreground">
          Held for every Banda key and the mouse's moves. Pick one your desktop
          leaves free.
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Main key"
        className="grid grid-cols-2 gap-1.5 sm:grid-cols-4"
      >
        {PICKS.map((one) => (
          <Pick
            key={modLabel(one.mod)}
            on={!own && sameMod(one.mod, now)}
            title={modLabel(one.mod)}
            detail={one.when}
            onClick={() => {
              setOwning(false)
              pick(one.mod)
            }}
          />
        ))}
        <Pick
          on={own}
          title="Your own"
          detail={own ? modLabel(now) : "any of them"}
          onClick={() => setOwning(true)}
        />
      </div>
      {own && (
        <div className="flex flex-wrap gap-1.5">
          {HELD.map(({ one, name }) => (
            <Button
              key={one}
              variant={now[one] ? "default" : "outline"}
              size="sm"
              aria-pressed={now[one]}
              onClick={() => pick({ ...now, [one]: !now[one] })}
            >
              {name}
            </Button>
          ))}
        </div>
      )}
      {[...new Set(refused)].map((one) => (
        <p key={one} role="alert" className="text-meta text-destructive">
          {withoutPlace(one)}
        </p>
      ))}
      {asked && (
        <div className="flex flex-col gap-2 rounded-control border bg-muted/40 px-3 py-2 text-meta">
          <p>
            {asked.moves.length === 1
              ? "One of your keys holds"
              : `${asked.moves.length} of your keys hold`}{" "}
            {modLabel(asked.from)}, the main key before. Move them to{" "}
            {modLabel(asked.mod)}?
          </p>
          {asked.moves.map(({ bind, to }) => (
            <div key={bind.text} className="flex items-center gap-1.5">
              <Kbd>{keyLabel(bind)}</Kbd>
              {to ? (
                <>
                  <span className="text-muted-foreground">→</span>
                  <Kbd>{keyLabel(to)}</Kbd>
                  <span className="font-mono text-muted-foreground">
                    {bind.action}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  goes: it freed the key for the Pane, and the key is no longer
                  Banda's
                </span>
              )}
            </div>
          ))}
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => move(asked.moves)}>
              Move
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAsked(undefined)}
            >
              Keep as they are
            </Button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-6 gap-y-1 text-meta">
        {SHOWN.map(([action, title]) => {
          const key = keyFor(action)
          return (
            key && (
              <div
                key={action}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 text-muted-foreground">{title}</span>
                <Kbd className="shrink-0">{key}</Kbd>
              </div>
            )
          )
        })}
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 text-muted-foreground">
            Move a Pane, or its whole Group
          </span>
          <Kbd className="shrink-0">{modLabel(now)} + drag</Kbd>
        </div>
      </div>
    </Card>
  )
}

function Pick({
  on,
  title,
  detail,
  onClick,
}: {
  on: boolean
  title: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-col items-start gap-0.5 rounded-control border px-2.5 py-1.5 text-left text-muted-foreground hover:text-foreground",
        on && "border-foreground/60 bg-secondary text-foreground"
      )}
    >
      <span className="text-ui font-medium">{title}</span>
      <span className="w-full truncate text-meta text-muted-foreground">
        {detail}
      </span>
    </button>
  )
}

/** A refusal's words, without the file's path and place before them. */
function withoutPlace(problem: string): string {
  return problem.replace(/^.*?:\d+:\d+: /, "")
}
