/**
 * What a browser shows at a machine's door before that machine has paired
 * it (ADR 0124, decision 6; SE5): whose door it is, the code the Person
 * compares, what to do with it, and the name this browser will go by
 * there. Until Allow the page knows nothing of the Person, so the card
 * is all there is. Allowed, the page becomes the window.
 */
import { useEffect, useId, useState } from "react"
import type { Asking } from "@banda/contract"
import { clock } from "@banda/core"
import { BandaMark } from "@banda/ui/components/banda-mark"
import { Button } from "@banda/ui/components/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@banda/ui/components/input-group"
import { Spinner } from "@banda/ui/components/spinner"
import { CheckIcon, GlobeIcon, SmartphoneIcon } from "lucide-react"
import type { Pairs, Self } from "../boot/browser"

/** The longest name a device asks under, as the Person reads it in a
 * list. */
const NAME_MAX = 60

export function Pairing({
  machine,
  suggested,
  pair,
  onPaired,
}: {
  /** The machine at the door, by the name it gives itself; none while it
   * has not said, or where nothing answers. */
  machine: string | undefined
  /** What this browser suggests it is read by, and its kind. */
  suggested: Self
  pair: Pairs
  /** The machine paired this device: the page opens the window. */
  onPaired: () => void
}) {
  const [name, setName] = useState(suggested.name)
  /** The name it asks under now, and which asking this is: a new name,
   * or asking again, is a new asking with a new code. */
  const [asks, setAsks] = useState({ name: suggested.name, nth: 0 })
  /** How an asking stands, and the code it showed, for the card that
   * says it expired; of the asking before, it counts for nothing. */
  const [heard, setHeard] = useState<{
    of: typeof asks
    asking: Asking
    code?: { code: string; until: number }
  }>()
  const { asking, code } = heard?.of === asks ? heard : {}
  const title = useId()
  const field = useId()
  const { kind } = suggested
  const what = kind === "phone" ? "phone" : "browser"
  const where = machine ?? "this machine"
  const Icon = kind === "phone" ? SmartphoneIcon : GlobeIcon

  useEffect(() => {
    return pair({ name: asks.name, kind }, (asking) => {
      setHeard((was) => ({
        of: asks,
        asking,
        code:
          asking.state === "asked"
            ? asking
            : was?.of === asks
              ? was.code
              : undefined,
      }))
      if (asking.state === "paired") onPaired()
    })
  }, [asks, kind, pair, onPaired])

  const again = () => setAsks(({ name, nth }) => ({ name, nth: nth + 1 }))
  /** The name as written, asked under once the Person leaves the field. */
  const renamed = () => {
    const written = name.trim()
    if (!written) return setName(asks.name)
    setName(written)
    if (written !== asks.name) setAsks({ name: written, nth: 0 })
  }

  /** What the card says of an asking that ended, and what asks again. */
  const ended =
    asking?.state === "lost"
      ? {
          title: "No answer",
          detail: `The door of ${where} did not answer.`,
          again: "Ask again",
        }
      : asking?.state !== "refused"
        ? undefined
        : asking.refusal.code === "expired"
          ? {
              title: "The code expired",
              detail: code
                ? `Nobody allowed this ${what} by ${clock(code.until)}.`
                : `Nobody allowed this ${what} in time.`,
              again: "Get a new code",
              // Struck through, so nobody compares it.
              old: code?.code,
            }
          : {
              title: "Not allowed",
              detail:
                asking.refusal.code === "forbidden"
                  ? `This ${what} was not allowed on ${where}.`
                  : asking.refusal.message,
              again: "Ask again",
            }
  return (
    <main className="grid h-dvh place-items-center px-4 py-6">
      <section
        aria-labelledby={title}
        data-pairing={asking?.state ?? "asking"}
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-tile border bg-tile px-7 pt-8 pb-6 text-center text-ui shadow-tile"
      >
        <BandaMark variant="logo" playful={0} className="size-9" />
        <h1 id={title} className="text-title font-semibold">
          {machine ?? "Banda"}
        </h1>
        {asking?.state === "paired" ? (
          <>
            <div>
              <p className="inline-flex items-center gap-1.5 text-title font-semibold">
                <CheckIcon aria-hidden className="size-4 text-added" />
                Allowed
              </p>
              <p className="text-muted-foreground">On {where}.</p>
            </div>
            <Waits>Opening Banda…</Waits>
          </>
        ) : ended ? (
          <>
            {ended.old && (
              <p className="font-mono text-heading font-semibold text-muted-foreground/60 tabular-nums line-through">
                {ended.old}
              </p>
            )}
            <div role="status">
              <p className="text-title font-semibold">{ended.title}</p>
              <p className="text-muted-foreground">{ended.detail}</p>
            </div>
            <Button onClick={again}>{ended.again}</Button>
          </>
        ) : (
          <>
            <p
              aria-label="Code"
              className="min-h-(--text-figure--line-height) font-mono text-figure font-semibold tabular-nums"
            >
              {asking?.state === "asked" ? asking.code : ""}
            </p>
            <div className="flex flex-col gap-1">
              <p>Allow this {what} in Banda on a computer you already use.</p>
              <p className="text-meta text-muted-foreground">
                The code there must match this one.
              </p>
            </div>
            <hr className="w-full border-border" />
            <div className="flex w-full items-center gap-2 text-left">
              <label
                htmlFor={field}
                className="shrink-0 text-meta text-muted-foreground"
              >
                This {what}
              </label>
              <InputGroup className="min-w-0 flex-1">
                <InputGroupAddon>
                  <Icon aria-hidden />
                </InputGroupAddon>
                <InputGroupInput
                  id={field}
                  value={name}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={renamed}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur()
                  }}
                />
              </InputGroup>
            </div>
            <Waits>
              {asking?.state === "asked"
                ? `Waiting for Allow · the code is good until ${clock(asking.until)}`
                : `Asking ${where}…`}
            </Waits>
          </>
        )}
      </section>
    </main>
  )
}

/** What the card waits for, in a quiet line. */
function Waits({ children }: { children: string }) {
  return (
    <p
      role="status"
      className="inline-flex items-center gap-1.5 text-meta text-muted-foreground"
    >
      <Spinner aria-hidden className="size-3.5" />
      {children}
    </p>
  )
}
