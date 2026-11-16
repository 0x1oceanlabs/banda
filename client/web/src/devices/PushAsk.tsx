/**
 * Pushes, as a phone's list asks for them once (ADR 0124, decision 10;
 * SE7): a card over the list, with what to do so an Agent's call reaches
 * the phone in a pocket. In an iPhone's Safari that is to put the page on
 * the Home Screen, where alone iOS lets a page take pushes; from there,
 * and in any other browser, one tap, and the browser asks. "Not now" puts
 * the card aside for good on this device: Settings → Devices has the same
 * switch.
 *
 * `PushKept` is the other half: while pushes are on, it says to every
 * machine the page reaches where a push finds this device.
 */
import type { Engine } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import { toast } from "@banda/ui/components/sonner"
import { useAct } from "@banda/ui/hooks/use-act"
import { useEffect, useState } from "react"
import { named } from "./asking"
import { kept, later, turnOn, useStand } from "./push"
import { useReached } from "./reached"

export function PushAsk({ engine }: { engine: Engine }) {
  const stand = useStand()
  const reached = useReached(engine)
  const [aside, setAside] = useState(later.is)
  const { busy, problem, act } = useAct()
  if (aside || (stand !== "home" && stand !== "ask")) return null
  const notNow = () => {
    later.say()
    setAside(true)
  }
  const on = () =>
    act(async () => {
      const now = await turnOn(reached.map((one) => one.engine))
      if (now === "on") toast("Pushes are on for this device")
    }, "Turn on")
  return (
    <section
      data-push-ask={stand}
      aria-label="Pushes"
      className="m-(--gap-outer) mb-0 flex shrink-0 flex-col gap-2 rounded-tile border bg-panel p-4 text-ui"
    >
      <h2 className="font-medium">Get a push when an Agent calls you</h2>
      {stand === "home" ? (
        <>
          <p className="text-muted-foreground">
            In Safari, Banda cannot push. Add it to your Home Screen first:
          </p>
          <ol className="list-decimal pl-5 text-muted-foreground">
            <li>Tap Share</li>
            <li>Add to Home Screen</li>
            <li>Open Banda from there, and let it join once more</li>
          </ol>
        </>
      ) : (
        <p className="text-muted-foreground">
          {named(reached.map((one) => one.name))} will push to this device while
          you are not looking at Banda.
        </p>
      )}
      {problem && (
        <p role="alert" className="text-meta text-destructive">
          {problem}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={notNow}>
          Not now
        </Button>
        {stand === "ask" && (
          <Button disabled={busy} onClick={() => void on()}>
            Turn on
          </Button>
        )}
      </div>
    </section>
  )
}

/** While this device takes pushes, tells each machine the page reaches
 * where one finds it: as the page starts, and as it reaches another. */
export function PushKept({ engine }: { engine: Engine }) {
  const on = useStand() === "on"
  const reached = useReached(engine)
  useEffect(() => {
    if (!on) return
    // A browser that gives no subscription now gives one the next time.
    void kept(reached.map((one) => one.engine)).catch(() => {})
  }, [on, reached])
  return null
}
