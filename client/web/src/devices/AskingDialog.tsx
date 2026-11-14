/**
 * The question a window asks when a device asks at a machine's door to
 * be paired (ADR 0124, decision 3; SE5): its name, the code its own
 * screen shows, and the address of the page that asks, over the window,
 * as a paired device gets all the Person can do there. One gesture lets
 * it in at every door the window reaches, or only where it asked. Closed
 * without an answer, it keeps asking until its time is out, and this
 * window says no more of it.
 */
import { useEffect, useState } from "react"
import type { Engine } from "@banda/contract"
import type { Ask } from "@banda/contract/devices"
import { Button } from "@banda/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { RadioGroup } from "@banda/ui/components/radio-group"
import { useAct } from "@banda/ui/hooks/use-act"
import { useNow } from "@banda/ui/hooks/use-now"
import { toast } from "@banda/ui/components/sonner"
import {
  allow,
  type Asked,
  askedWords,
  hearAsking,
  named,
  type Reached,
} from "./asking"
import { ChoiceCard } from "./ChoiceCard"
import { KIND_ICONS, useReached } from "./reached"

/** Who asks at each of `reached`'s doors now, the first to ask first. */
function useAsked(reached: readonly Reached[]): Asked[] {
  const [heard, setHeard] = useState<Map<Engine, readonly Ask[]>>(new Map())
  useEffect(() => {
    const stops = reached.map(({ engine }) =>
      hearAsking(engine, (asking) =>
        setHeard((was) => new Map(was).set(engine, asking))
      )
    )
    return () => stops.forEach((stop) => stop())
  }, [reached])
  return reached
    .flatMap((at) => (heard.get(at.engine) ?? []).map((ask) => ({ ask, at })))
    .sort((a, b) => a.ask.asked_at - b.ask.asked_at)
}

export function DevicesAsking({ engine }: { engine: Engine }) {
  const reached = useReached(engine)
  const asked = useAsked(reached)
  // The codes this window closed without an answer.
  const [closed, setClosed] = useState<readonly string[]>([])
  const one = asked.find(({ ask }) => !closed.includes(ask.code))
  if (!one) return null
  return (
    <Question
      key={one.ask.code}
      asked={one}
      others={reached.filter((at) => at !== one.at)}
      onClose={() => setClosed((was) => [...was, one.ask.code])}
    />
  )
}

function Question({
  asked: { ask, at },
  others,
  onClose,
}: {
  asked: Asked
  /** The other machines the window reaches. */
  others: readonly Reached[]
  onClose: () => void
}) {
  const [where, setWhere] = useState<"every" | "one">("every")
  const { busy, problem, act } = useAct()
  const now = useNow(10_000)
  const Icon = KIND_ICONS[ask.kind]
  const every = named([at, ...others].map(({ name }) => name))
  const answer = (how: "allow" | "refuse") =>
    act(
      async () => {
        if (how === "refuse")
          return at.engine.command("devices.refuse", { code: ask.code })
        const also = where === "every" ? others : []
        const { device, missed } = await allow(at.engine, ask.code, also)
        const joined = also.filter(({ name }) => !missed.includes(name))
        toast(
          `${device.name} joined ${named([at, ...joined].map((m) => m.name))}`,
          {
            description:
              missed.length > 0
                ? `Not ${named(missed)}: it asks there again.`
                : undefined,
          }
        )
      },
      how === "allow" ? "Allow" : "Don't allow"
    )
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        showCloseButton={false}
        data-devices-asking={ask.code}
        // Not on Allow: a key meant for a message lets no device in.
        initialFocus={false}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>
            {ask.name} wants to join {at.name}
          </DialogTitle>
          <DialogDescription>
            Allow it only if that {ask.kind === "phone" ? "phone" : "device"}{" "}
            shows this code. It gets all you can do there.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-muted text-muted-foreground">
            <Icon aria-hidden className="size-4" />
          </span>
          <div className="min-w-0">
            <p aria-label="Code" className="font-mono text-title tracking-wide">
              {ask.code}
            </p>
            <p className="truncate text-meta text-muted-foreground">
              {askedWords(ask, now)}
            </p>
          </div>
        </div>
        {others.length > 0 && (
          <RadioGroup
            aria-label="Where it joins"
            value={where}
            onValueChange={(value) => setWhere(value as "every" | "one")}
          >
            <ChoiceCard
              value="every"
              title={`Allow on ${every}`}
              about="Every machine this window reaches."
            />
            <ChoiceCard
              value="one"
              title={`Only ${at.name}`}
              about="It asks again at each other machine."
            />
          </RadioGroup>
        )}
        {problem && (
          <p role="alert" className="text-meta text-destructive">
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void answer("refuse")}
          >
            Don't allow
          </Button>
          <Button disabled={busy} onClick={() => void answer("allow")}>
            Allow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
