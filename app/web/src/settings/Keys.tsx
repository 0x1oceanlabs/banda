/**
 * Keys (ADR 0016; ADR 0005, decision 11): the lines of the Person's
 * `keys.toml`, each a key and the action it runs, in the frame every row
 * has. A line takes another key where it is, or ↶ takes it out. Every
 * action and all its keys are the key sheet's, Alt+K in the window (ADR
 * 0017, decision 9), so there is one list of keys; this opens it there.
 * `banda settings` writes the file and checks the key, and the look
 * brings the keys back to the window.
 */
import { useEffect, useState } from "react"
import type { Bind } from "@banda/contract/look"
import { Button } from "@banda/ui/components/button"
import { Card } from "@banda/ui/components/card"
import { Kbd } from "@banda/ui/components/kbd"
import { useWrite } from "@banda/ui/hooks/use-write"
import { keyToBind } from "@banda/ui/lib/keys"
import { KeyboardIcon } from "lucide-react"
import { bindPath, KEYS_FILE, keyName, RESET_KEY } from "../actions/actions"
import { useLookKeys } from "../look"
import { RowFrame } from "./SettingRow"

export function Keys({ lit }: { lit?: string }) {
  const keys = useLookKeys()
  // The line that waits for a key, if one does: one at a time.
  const [asking, setAsking] = useState<string>()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 px-1">
        <p className="flex-1 text-xs text-muted-foreground">
          Choose an action in the key sheet, press Tab, then Add a key. Assign a
          key to another action to change what it runs. Change or reset your
          keys below.
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
  const { refused, write } = useWrite({ against: bind })
  const settings = window.banda?.settings

  // While it asks, the next key pressed is the line's: the line takes it
  // where it is, its action and comment kept. Esc stops.
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
      write(settings.rename(KEYS_FILE, bindPath(bind), keyName(pressed.key)))
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [asking, ask, settings, bind, write])

  return (
    <RowFrame
      dataKey={bind.text}
      lit={lit}
      title={
        bind.action ? (
          <span>
            <span className="font-normal">runs</span>{" "}
            <span className="font-mono text-xs">{bind.action}</span>
          </span>
        ) : (
          <span className="font-normal text-muted-foreground">
            goes to the Pane
          </span>
        )
      }
      file={KEYS_FILE}
      from={{ layer: "file", line: bind.line }}
      onReset={() =>
        settings && write(settings.reset(KEYS_FILE, bindPath(bind)))
      }
      wrong={refused}
    >
      <Button
        variant="outline"
        size="sm"
        className="min-w-28"
        aria-label={`Change ${bind.text}`}
        title="Press another key for this line"
        // While it asks, it takes every key, the window's own too.
        data-takes-keys={asking ? "" : undefined}
        onClick={() => ask(!asking)}
      >
        {asking ? (
          <span className="text-muted-foreground">Press a key…</span>
        ) : (
          <Kbd>{bind.text}</Kbd>
        )}
      </Button>
    </RowFrame>
  )
}
