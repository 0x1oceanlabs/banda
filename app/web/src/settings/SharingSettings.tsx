/**
 * The Sharing section (ADR 0039, decisions 4–8). Its switches are
 * `sharing.toml`'s rows; this draws the rest, under them: the random ID
 * Banda sends with, and New ID; each event of the last seven days, as it
 * went, its exact JSON a click away; and why this Banda never sends, when
 * it does not.
 */
import { useCallback, useState } from "react"
import type { Never, Sent } from "@banda/contract/sharing"
import { SHARING_FILE } from "@banda/contract/sharing"
import { Button } from "@banda/ui/components/button"
import { useAct } from "@banda/ui/hooks/use-act"
import { useRead } from "@banda/ui/hooks/use-read"
import { useFile } from "@banda/ui/lib/look"
import { cn } from "@banda/ui/lib/utils"
import { clock } from "@banda/ui/lib/words"
import type { SectionProps } from "./sections"
import { Group, Rows } from "./SettingRow"

const NEVER: Record<Never, string> = {
  checkout:
    "This Banda runs from a checkout: it never sends, whatever is on. CI and the tests never send either.",
  run: "BANDA_SHARING=0 is set: this run of Banda never sends, whatever is on.",
}

export function SharingSettings({ engine }: SectionProps) {
  const { problems, usage } = useFile(SHARING_FILE)
  const [made, setMade] = useState(0)
  const read = useCallback(
    () => engine.call("sharing.state", {}),
    // The engine makes the ID as sharing turns on and erases it as all of
    // it turns off: it is read again as the file changes, and once more
    // after New ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again on purpose
    [engine, problems, usage, made]
  )
  const state = useRead(read)
  const shared = state.state === "ready" ? state.value : undefined
  const { busy, problem, act } = useAct()
  const newId = () =>
    act(async () => {
      await engine.command("sharing.new_id", {})
      setMade((n) => n + 1)
    })
  const refused = state.state === "refused" ? state.refusal.message : undefined

  return (
    <div className="flex flex-col gap-4">
      <Rows>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm">Your ID</span>
            <span className="text-xs text-muted-foreground">
              {shared?.id ? (
                <>
                  <span className="font-mono" title={shared.id}>
                    {shared.id.slice(0, 4)}…{shared.id.slice(-4)}
                  </span>{" "}
                  · random, made when you turned sharing on; erased when you
                  turn all of it off.
                </>
              ) : (
                shared &&
                "None while nothing is shared. A random one is made when you turn sharing on."
              )}
            </span>
            {(problem ?? refused) && (
              <span role="alert" className="text-xs text-destructive">
                {problem ?? refused}
              </span>
            )}
          </div>
          {shared?.id && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void newId()}
            >
              New ID
            </Button>
          )}
        </div>
      </Rows>
      <Group title="Sent by Banda · kept 7 days">
        <Rows>
          {shared?.sent.length ? (
            shared.sent.map((sent) => (
              <SentRow key={`${sent.made}:${sent.event}`} sent={sent} />
            ))
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Nothing sent. Each event shows here before it goes, exactly as it
              goes.
            </p>
          )}
        </Rows>
      </Group>
      {shared?.never && (
        <p className="rounded-lg border border-dashed px-4 py-2 text-xs text-muted-foreground">
          {NEVER[shared.never]}
        </p>
      )}
    </div>
  )
}

const UTF8 = new TextEncoder()

/** One event: what it is about, and when it went; its JSON when open. */
function SentRow({ sent }: { sent: Sent }) {
  const [open, setOpen] = useState(false)
  const size = UTF8.encode(sent.json).length
  return (
    <div className={cn("flex flex-col", open && "bg-muted/50")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 px-4 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="font-mono text-xs">{sent.event}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {sent.about}
        </span>
        <span className="rounded-md border px-1.5 py-px text-[11px] text-muted-foreground">
          {sent.sent === null ? "waiting" : `sent ${clock(sent.sent)}`}
        </span>
        <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
          {(size / 1024).toFixed(1)} KB
        </span>
      </button>
      {open && (
        <pre className="mx-4 mb-3 overflow-auto rounded-md bg-muted px-2.5 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {sent.json}
        </pre>
      )}
    </div>
  )
}
