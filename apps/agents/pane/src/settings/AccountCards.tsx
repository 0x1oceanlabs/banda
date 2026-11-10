/**
 * The accounts as cards, by Harness (ADR 0093, decision 9): each shows its
 * emblem and name, Default or Fallback, its plan and email, its two own
 * limit windows, and its Threads and last use. A card opens its page; an
 * account that is off, signed out or spent shows dimmed, with what to do.
 */
import type { ReactNode } from "react"
import type { Engine } from "@banda/contract"
import type { HarnessView, Limits } from "@banda/contract/harnesses"
import { Button } from "@banda/ui/components/button"
import { Emblem } from "@banda/ui/components/emblem"
import { cn } from "@banda/ui/lib/utils"
import { clock } from "@banda/ui/lib/words"
import { PlusIcon } from "lucide-react"
import { useAccount } from "../harnesses"
import { outOf, usedOf } from "../thread/starts-on"
import { Meter, type Roles } from "./AccountPage"
import {
  type Use,
  cardWindows,
  lastWords,
  threadsWords,
  whoWords,
} from "./accounts"

type CardProps = {
  engine: Engine
  harness: HarnessView
  limits?: Limits
  now: number
  use?: Use
  roles: Roles
  onOpen: () => void
}

/** A Harness's accounts, and its Add card last. */
export function HarnessGroup({
  name,
  children,
  onAdd,
}: {
  name: string
  children: ReactNode
  onAdd: () => void
}) {
  return (
    <section
      aria-label={`${name} accounts`}
      className="@container flex flex-col gap-2"
    >
      <h3 className="text-sm font-semibold">{name}</h3>
      <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
        {children}
        <button
          type="button"
          className="flex min-h-20 items-center justify-center gap-1.5 rounded-card border border-dashed text-sm text-muted-foreground outline-none hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onAdd}
        >
          <PlusIcon className="size-4" />
          Add a {name} account
        </button>
      </div>
    </section>
  )
}

/** An account's card: it asks the Harness who is signed in while on. */
export function AccountCard(props: CardProps) {
  return props.harness.enabled ? (
    <Reading {...props} />
  ) : (
    <Frame {...props} dim>
      <p className="text-xs text-muted-foreground">
        Off: no new Thread starts on it.
      </p>
    </Frame>
  )
}

function Reading(props: CardProps) {
  const { engine, harness, limits, now, use, onOpen } = props
  const read = useAccount(engine, harness.id)
  const who =
    read.state === "ready" ? read.view.account.signed_in_as : undefined
  const signedOut = who?.signed_in === false
  const out = outOf(limits, now)
  const windows = cardWindows(limits)
  const middle =
    read.state === "refused" ? (
      <p className="text-xs text-destructive">Does not start</p>
    ) : signedOut ? (
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-destructive">Not signed in</span>
        <Button size="xs" className="relative" onClick={onOpen}>
          Sign in
        </Button>
      </div>
    ) : windows.length > 0 ? (
      <div className="grid grid-cols-2 gap-3">
        {windows.map((window) => {
          const used = usedOf(window, now)
          return (
            <div
              key={window.id}
              className="flex flex-col gap-1 text-xs"
              title={
                window.resets_at === undefined
                  ? undefined
                  : `${window.label}: starts again ${clock(window.resets_at, now)}`
              }
            >
              <span className="flex justify-between gap-1 text-muted-foreground">
                <span className="truncate">{window.label}</span>
                <span className="font-medium text-foreground tabular-nums">
                  {Math.round(used)}%
                </span>
              </span>
              <Meter label={window.label} used={used} />
            </div>
          )
        })}
      </div>
    ) : null
  return (
    <Frame
      {...props}
      who={whoWords(limits, who)}
      dim={read.state === "refused" || signedOut || out !== undefined}
    >
      {middle}
      {!signedOut && read.state !== "refused" && (
        <p className="flex justify-between gap-2 text-xs text-muted-foreground">
          {out ? (
            <span className="text-destructive">
              Out{out.until === undefined ? "" : ` until ${clock(out.until)}`}
            </span>
          ) : (
            <span>{threadsWords(use?.threads ?? 0)}</span>
          )}
          <span>{lastWords(use?.last, now)}</span>
        </p>
      )}
    </Frame>
  )
}

/** The card itself: the whole of it opens the page, under what it holds
 * to click. */
function Frame({
  harness,
  roles,
  onOpen,
  who,
  dim,
  children,
}: CardProps & { who?: string; dim?: boolean; children: ReactNode }) {
  const role =
    roles.default === harness.id
      ? "Default"
      : roles.fallback === harness.id
        ? "Fallback"
        : undefined
  return (
    <div
      role="group"
      aria-label={harness.name}
      className={cn(
        "relative flex min-w-0 flex-col gap-2.5 rounded-card border bg-card p-3 hover:border-foreground/30",
        dim && "opacity-70"
      )}
    >
      <button
        type="button"
        aria-label={`Open ${harness.name}`}
        className="absolute inset-0 rounded-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpen}
      />
      <div className="flex min-w-0 items-center gap-2.5">
        <Emblem of={harness} className="size-6" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{harness.name}</p>
          <p className="truncate text-xs text-muted-foreground">{who ?? " "}</p>
        </div>
        {role && (
          <span
            className={cn(
              "rounded-control bg-secondary px-1.5 py-0.5 text-[10px]",
              role === "Fallback" && "text-muted-foreground"
            )}
          >
            {role}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}
