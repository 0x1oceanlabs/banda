import { useCallback, useState } from "react"
import type { Engine, JsonValue, SpaceId } from "@bandaso/contract"
import type { Account, HarnessView } from "@bandaso/contract/agents"
import { Button } from "@bandaso/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@bandaso/ui/components/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bandaso/ui/components/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@bandaso/ui/components/field"
import { RadioGroup, RadioGroupItem } from "@bandaso/ui/components/radio-group"
import { ScrollArea } from "@bandaso/ui/components/scroll-area"
import { Spinner } from "@bandaso/ui/components/spinner"
import { useAct } from "@bandaso/ui/hooks/use-act"
import { useRead } from "@bandaso/ui/hooks/use-read"
import { definePane, type PaneProps } from "@bandaso/ui/pane"
import { LogOutIcon, RotateCwIcon, SettingsIcon } from "lucide-react"
import { type FollowUp, useFollowUp } from "./follow-up"
import { Problem, Ways } from "./SignIn"

type NoArgs = { [key: string]: JsonValue }

/**
 * The Harnesses on this computer, as T3 Code's settings show its
 * providers: what each runs, who is signed in, and signing in and out;
 * then what a message written while an Agent works does.
 */
export const harnessesPane = definePane<NoArgs>({
  kind: "agents.harnesses",
  module: "agents",
  title: () => "Harnesses",
  icon: SettingsIcon,
  start: {},
  Pane: HarnessesPane,
})

function HarnessesPane({ engine, space }: PaneProps<NoArgs>) {
  const harnesses = useRead(
    useCallback(
      () => engine.call<HarnessView[]>("agents.harnesses", {}, { space }),
      [engine, space]
    )
  )
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-6 p-4">
        <section className="flex flex-col gap-3">
          {harnesses.state === "loading" && <Spinner />}
          {harnesses.state === "refused" && (
            <Problem>{harnesses.refusal.message}</Problem>
          )}
          {harnesses.state === "ready" &&
            harnesses.value.map((harness) => (
              <HarnessCard
                key={harness.id}
                engine={engine}
                space={space}
                harness={harness}
              />
            ))}
        </section>
        <FollowUpChoice />
      </div>
    </ScrollArea>
  )
}

type HarnessProps = { engine: Engine; space: SpaceId; harness: HarnessView }

/** A Harness entry, looked at again after each sign-in or sign-out. */
function HarnessCard(props: HarnessProps) {
  const [looks, setLooks] = useState(0)
  return (
    <HarnessLook key={looks} {...props} again={() => setLooks((n) => n + 1)} />
  )
}

/** One look starts the Harness if it does not run, and asks it. */
function HarnessLook({
  engine,
  space,
  harness,
  again,
}: HarnessProps & { again: () => void }) {
  const account = useRead(
    useCallback(
      () =>
        engine.call<Account>(
          "agents.account",
          { harness: harness.id },
          { space }
        ),
      [engine, space, harness.id]
    )
  )
  return (
    <Card size="sm" role="group" aria-label={harness.name}>
      <CardHeader>
        <CardTitle>{harness.name}</CardTitle>
        {account.state === "ready" && account.value.adapter && (
          <CardDescription>
            {account.value.adapter.name} {account.value.adapter.version}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {account.state === "loading" && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Starting {harness.name}…
          </span>
        )}
        {account.state === "refused" && (
          <div className="flex flex-col items-start gap-2">
            <Problem>
              {harness.name} does not start: {account.refusal.message}
            </Problem>
            <Button variant="outline" size="xs" onClick={again}>
              <RotateCwIcon data-icon="inline-start" />
              Check again
            </Button>
          </div>
        )}
        {account.state === "ready" && (
          <AccountState
            engine={engine}
            space={space}
            harness={harness}
            account={account.value}
            onChanged={again}
          />
        )}
      </CardContent>
    </Card>
  )
}

function AccountState({
  engine,
  space,
  harness,
  account,
  onChanged,
}: {
  engine: Engine
  space: SpaceId
  harness: HarnessView
  account: Account
  onChanged: () => void
}) {
  const who = account.signed_in_as
  if (who?.signed_in)
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm">
          Signed in as {[who.email, who.label].filter(Boolean).join(" · ")}
          {who.detail && (
            <span className="text-muted-foreground"> ({who.detail})</span>
          )}
        </p>
        {account.signs_out && (
          <SignOut
            engine={engine}
            space={space}
            harness={harness}
            onSignedOut={onChanged}
          />
        )}
      </div>
    )
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {who
          ? "Not signed in."
          : `${harness.name} does not say who is signed in.`}
      </p>
      <Ways
        engine={engine}
        space={space}
        harness={harness.id}
        ways={account.ways}
        onSignedIn={onChanged}
      />
    </div>
  )
}

function SignOut({
  engine,
  space,
  harness,
  onSignedOut,
}: {
  engine: Engine
  space: SpaceId
  harness: HarnessView
  onSignedOut: () => void
}) {
  const [asking, setAsking] = useState(false)
  const signing = useAct()
  const signOut = async () => {
    const done = await signing.act(() =>
      engine.command("agents.sign_out", { harness: harness.id }, space)
    )
    if (done === undefined) return
    setAsking(false)
    onSignedOut()
  }
  return (
    <>
      <Button variant="outline" size="xs" onClick={() => setAsking(true)}>
        <LogOutIcon data-icon="inline-start" />
        Sign out
      </Button>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out of {harness.name}?</DialogTitle>
            <DialogDescription>
              Every Space on this computer uses this sign-in, so their Agents on{" "}
              {harness.name} stop working until someone signs in again. Their
              Threads stay.
            </DialogDescription>
          </DialogHeader>
          {signing.problem && <Problem>{signing.problem}</Problem>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              disabled={signing.busy}
              onClick={() => void signOut()}
            >
              {signing.busy && <Spinner />}
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

const FOLLOW_UPS: { value: FollowUp; label: string; about: string }[] = [
  {
    value: "steer",
    label: "Send it into the turn",
    about: "The Agent reads it as it works.",
  },
  {
    value: "queue",
    label: "Queue it",
    about: "It goes once the turn ends.",
  },
]

function FollowUpChoice() {
  const [followUp, choose] = useFollowUp()
  return (
    <FieldSet>
      <FieldLegend id="follow-up" variant="label">
        When you press Enter while an Agent works
      </FieldLegend>
      <FieldDescription>
        Ctrl+Enter (⌘+Enter on a Mac) does the other. This window keeps the
        choice.
      </FieldDescription>
      <RadioGroup
        value={followUp}
        aria-labelledby="follow-up"
        onValueChange={(next) => choose(next as FollowUp)}
      >
        {FOLLOW_UPS.map((choice) => {
          const id = `follow-up-${choice.value}`
          return (
            <Field key={choice.value} orientation="horizontal">
              <RadioGroupItem
                value={choice.value}
                id={id}
                aria-describedby={`${id}-about`}
              />
              <FieldContent>
                <FieldLabel htmlFor={id}>{choice.label}</FieldLabel>
                <FieldDescription id={`${id}-about`}>
                  {choice.about}
                </FieldDescription>
              </FieldContent>
            </Field>
          )
        })}
      </RadioGroup>
    </FieldSet>
  )
}
