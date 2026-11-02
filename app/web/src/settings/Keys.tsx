/**
 * Keys (ADR 0016; ADR 0005, decision 11): the lines of the Person's
 * `keys.toml`, each a key and the action it runs. A line takes another key,
 * or ↶ takes it out. Every action and all its keys are the key sheet's,
 * Alt+K in the window (ADR 0017, decision 9), so there is one list of
 * keys; this opens it there. `banda settings` writes the file and checks
 * the key, and the look brings the keys back to both windows.
 */
import { useEffect, useState } from "react"
import type { Bind } from "@banda/contract/look"
import { Button } from "@banda/ui/components/button"
import { Card } from "@banda/ui/components/card"
import { Kbd } from "@banda/ui/components/kbd"
import { useWrite } from "@banda/ui/hooks/use-write"
import { keyToBind } from "@banda/ui/lib/keys"
import { cn } from "@banda/ui/lib/utils"
import { KeyboardIcon, Undo2Icon } from "lucide-react"
import {
  bindPath,
  KEYS_FILE,
  keyName,
  RESET_KEY,
  writeBind,
} from "../actions/actions"
import { useLookKeys } from "../look"

export function Keys({ lit }: { lit?: string }) {
  const keys = useLookKeys()
  // The line that waits for a key, if one does: one at a time.
  const [asking, setAsking] = useState<string>()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 px-1">
        <p className="flex-1 text-xs text-muted-foreground">
          The key sheet lists every action with all its keys; add a key or free
          one there, and its line shows here.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.banda?.menu.open("actions")}
        >
          <KeyboardIcon />
          Open the key sheet
        </Button>
      </div>
      <Card className="gap-0 divide-y py-0">
        {keys.binds.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No keys of your own: Banda's are all there are.
          </p>
        ) : (
          keys.binds.map((bind) => (
            <Line
              key={bind.text}
              bind={bind}
              lit={bind.text === lit}
              asking={asking === bind.text}
              ask={(on) => setAsking(on ? bind.text : undefined)}
            />
          ))
        )}
      </Card>
      <p className="px-1 text-xs text-muted-foreground">
        <Kbd>{keyName(RESET_KEY)}</Kbd> brings the window's own keys back until
        keys.toml changes, and opens this page. No file binds it.
      </p>
    </div>
  )
}

/** One line: its key, what it runs, and where it is. */
function Line({
  bind,
  lit,
  asking,
  ask,
}: {
  bind: Bind
  lit: boolean
  /** It waits for the next key pressed. */
  asking: boolean
  ask: (on: boolean) => void
}) {
  const { refused, write } = useWrite()
  const settings = window.banda?.settings

  // While it asks, the next key pressed is the line's, the action kept;
  // the old line goes once the new one is written. Esc stops.
  useEffect(() => {
    if (!asking || !settings) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === "Escape") return ask(false)
      const pressed = keyToBind(event)
      if (!pressed) return
      ask(false)
      if ("refused" in pressed) return write(Promise.resolve([pressed.refused]))
      if (keyName(pressed.key) === bind.text) return
      write(
        writeBind(pressed.key, bind.action ?? "none").then((wrong) =>
          wrong.length > 0 ? wrong : settings.reset(KEYS_FILE, bindPath(bind))
        )
      )
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [asking, ask, settings, bind, write])

  return (
    <div
      data-key={bind.text}
      className={cn(
        "flex flex-col gap-1 px-4 py-2.5 transition-colors",
        lit && "bg-accent/60"
      )}
    >
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className="min-w-28"
          aria-label={`Change ${bind.text}`}
          title="Press another key for this line"
          onClick={() => ask(!asking)}
        >
          {asking ? (
            <span className="text-muted-foreground">Press a key…</span>
          ) : (
            <Kbd>{bind.text}</Kbd>
          )}
        </Button>
        <div className="min-w-0 flex-1 text-sm">
          {bind.action ? (
            <>
              runs <span className="font-mono text-xs">{bind.action}</span>
            </>
          ) : (
            <span className="text-muted-foreground">goes to the Pane</span>
          )}
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          {KEYS_FILE}:{bind.line}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={`Reset ${bind.text}`}
          title="Reset: take the line out"
          onClick={() =>
            settings && write(settings.reset(KEYS_FILE, bindPath(bind)))
          }
        >
          <Undo2Icon />
        </Button>
      </div>
      {[...new Set(refused)].map((message) => (
        <p key={message} role="alert" className="text-xs text-destructive">
          {message}
        </p>
      ))}
    </div>
  )
}
