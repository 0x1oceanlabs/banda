/**
 * The first run's question of sharing (ADR 0039, decision 5): "Help make
 * Banda better?", asked once, over the window. Neither box is ticked, and
 * there is one button, Continue: what it writes into `sharing.toml` is the
 * answer, so a file that says either key was asked already, and Settings →
 * Sharing is where it changes. A Banda from before the question asks it
 * once too.
 */
import { useCallback, useId, useState } from "react"
import type { Engine } from "@banda/contract"
import type { Look } from "@banda/contract/look"
import { tomlOf } from "@banda/contract/settings"
import { SHARING_FILE, type Shares } from "@banda/contract/sharing"
import { Button } from "@banda/ui/components/button"
import { Checkbox } from "@banda/ui/components/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@banda/ui/components/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@banda/ui/components/field"
import { useAct } from "@banda/ui/hooks/use-act"
import { useRead } from "@banda/ui/hooks/use-read"
import { useLook } from "@banda/ui/lib/look"

const { name: FILE, before: NONE } = SHARING_FILE

/** Whether the Person answered: the file says either key. */
function answered(look: Look): boolean {
  const keys = look.settings[FILE]
  return [keys?.problems, keys?.usage].some((k) => k?.from.layer === "file")
}

const CHOICES: { key: keyof Shares; title: string; about: string }[] = [
  {
    key: "problems",
    title: "Send problem reports",
    about:
      "When something in Banda breaks: what broke, where in Banda's code, its version and system. Each problem once a day.",
  },
  {
    key: "usage",
    title: "Send usage counts",
    about:
      "Once a day: how many Threads, Turns and Panes, by kind, and your country from the system's language. Never words, paths or names.",
  },
]

export function AskToShare({ engine }: { engine: Engine }) {
  // Hidden till the look comes, so an answered Banda never shows it.
  const asked = useLook(answered, true)
  const [ticked, setTicked] = useState<Shares>(NONE)
  const { busy, problem, act } = useAct()
  const id = useId()
  // What goes, as the engine makes each event: the same code sends them.
  const read = useCallback(() => engine.call("sharing.example", {}), [engine])
  const example = useRead(asked ? null : read)
  const settings = window.banda?.settings
  if (asked || !settings) return null

  const answer = (chosen: Shares) =>
    act(async () => {
      // One after the other: each reads the file and writes it back.
      for (const { key } of CHOICES) {
        const refused = await settings.set(FILE, key, tomlOf(chosen[key]))
        if (refused.length > 0) throw new Error(refused.join(" "))
      }
    })
  return (
    // Closed without Continue, nothing is shared: that is the answer too.
    <Dialog open onOpenChange={(open) => !open && !busy && void answer(NONE)}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100svh-2rem)] gap-4 overflow-y-auto sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Help make Banda better?</DialogTitle>
          <DialogDescription>
            Banda sends nothing unless you tick a box. You can change it any
            time in Settings → Sharing.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {CHOICES.map(({ key, title, about }) => (
            <Field
              key={key}
              orientation="horizontal"
              className="rounded-control border px-3 py-2.5"
            >
              <Checkbox
                id={`${id}-${key}`}
                aria-describedby={`${id}-${key}-about`}
                checked={ticked[key]}
                onCheckedChange={(on) =>
                  setTicked((was) => ({ ...was, [key]: on }))
                }
              />
              <FieldContent>
                <FieldLabel htmlFor={`${id}-${key}`}>{title}</FieldLabel>
                <FieldDescription id={`${id}-${key}-about`}>
                  {about}
                </FieldDescription>
              </FieldContent>
            </Field>
          ))}
        </div>
        <Collapsible className="flex min-w-0 flex-col gap-2">
          <CollapsibleTrigger className="group self-start text-xs text-primary hover:underline">
            <span className="group-data-panel-open:hidden">▸</span>
            <span className="hidden group-data-panel-open:inline">▾</span> See
            exactly what is sent
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-2">
            {example.state === "ready" ? (
              (["exception", "day"] as const).map((event) => (
                <pre
                  key={event}
                  className="max-h-36 overflow-auto rounded-control bg-muted px-2.5 py-2 font-mono text-meta leading-relaxed text-muted-foreground"
                >
                  {JSON.stringify(example.value[event], null, 2)}
                </pre>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                {example.state === "refused"
                  ? example.refusal.message
                  : "Reading the examples…"}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              To PostHog (US) with a random ID that is not you. No IP, no
              location, no profile.
            </p>
          </CollapsibleContent>
        </Collapsible>
        {problem && (
          <p role="alert" className="text-xs text-destructive">
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button disabled={busy} onClick={() => void answer(ticked)}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
