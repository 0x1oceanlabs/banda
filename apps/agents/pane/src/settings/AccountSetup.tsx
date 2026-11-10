/** Add a subscription Account: profile, name/emblem, sign-in (ADR 0093). */
import { useCallback, useState } from "react"
import type { Engine } from "@banda/contract"
import type { HarnessView, Icon } from "@banda/contract/harnesses"
import { tomlOf } from "@banda/contract/settings"
import { Button } from "@banda/ui/components/button"
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
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@banda/ui/components/field"
import { Input } from "@banda/ui/components/input"
import { Spinner } from "@banda/ui/components/spinner"
import { useRead } from "@banda/ui/hooks/use-read"
import { problem } from "@banda/ui/lib/words"
import { harnessTitle } from "../harnesses"
import { Problem } from "../thread/SignIn"
import type { SettingsFile } from "./AgentsSettings"
import { AccountLogin } from "./AccountLogin"
import { EmblemPicker } from "./AccountPage"
import { newAccountOf } from "./accounts"

const PURPOSES: { name: string; icon: Icon }[] = [
  { name: "Work", icon: "work" },
  { name: "Personal", icon: "personal" },
  { name: "Team", icon: "team" },
  { name: "Client", icon: "client" },
  { name: "Spare", icon: "spare" },
  { name: "Experiments", icon: "experiments" },
]

export function AccountSetup({
  engine,
  file,
  base,
  taken,
  onClose,
  onAdded,
}: {
  engine: Engine
  file: SettingsFile
  base: HarnessView
  taken: readonly HarnessView[]
  onClose: () => void
  onAdded: () => void
}) {
  const fresh = newAccountOf(base.harness, taken)
  const [step, setStep] = useState(0)
  const [existing, setExisting] = useState(false)
  const [folder, setFolder] = useState("")
  const [name, setName] = useState(fresh.name)
  const [icon, setIcon] = useState(base.icon)
  const [colour, setColour] = useState(fresh.colour)
  const [made, setMade] = useState<HarnessView>()
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [refused, setRefused] = useState<string>()
  const profiles = useRead(
    useCallback(() => engine.call("harnesses.account_profiles", {}), [engine])
  )
  const id = availableId(base.harness, taken)
  const draft = { ...base, id, name, icon, colour }
  const close = () => {
    if (!busy && !running) onClose()
  }
  const create = async () => {
    if (busy || !name.trim()) return
    setBusy(true)
    setRefused(undefined)
    let connected = false
    try {
      const account = await engine.call("harnesses.connect_account", {
        harness: base.harness,
        id,
        name: name.trim(),
        ...(existing && { folder: folder.trim() }),
      })
      connected = true
      setMade(account)
      setStep(2)
      // The profile exists even when an emblem write fails. Never create
      // another one when retrying a cosmetic choice.
      const wrong = [
        ...(await file.set(`harness.${account.id}.colour`, tomlOf(colour))),
      ]
      if (icon)
        wrong.push(
          ...(await file.set(`harness.${account.id}.icon`, tomlOf(icon)))
        )
      if (wrong.length) setRefused(`Account added. ${wrong.join(" ")}`)
    } catch (error) {
      setRefused(problem(error))
    } finally {
      if (connected) onAdded()
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Add a {harnessTitle(taken, base.harness)} account
          </DialogTitle>
          <DialogDescription>
            {
              [
                "1 of 3 · Choose an account",
                "2 of 3 · Name and emblem",
                "3 of 3 · Sign in",
              ][step]
            }
          </DialogDescription>
        </DialogHeader>
        {step === 0 && (
          <FieldGroup>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Account source"
            >
              <Button
                variant={existing ? "outline" : "default"}
                aria-pressed={!existing}
                onClick={() => setExisting(false)}
              >
                New subscription sign-in
              </Button>
              <Button
                variant={existing ? "default" : "outline"}
                aria-pressed={existing}
                onClick={() => setExisting(true)}
              >
                Connect an existing profile
              </Button>
            </div>
            {existing ? (
              <>
                {profiles.state === "loading" && <Spinner />}
                {profiles.state === "refused" && (
                  <Problem>{profiles.refusal.message}</Problem>
                )}
                {profiles.state === "ready" &&
                  profiles.value
                    .filter((one) => one.harness === base.harness)
                    .map((one) => (
                      <Button
                        key={one.folder}
                        variant="outline"
                        className="h-auto justify-start py-2 text-left break-all whitespace-normal"
                        disabled={one.account !== undefined}
                        aria-pressed={folder === one.folder}
                        onClick={() => setFolder(one.folder)}
                      >
                        {one.folder}
                        {one.account ? ` · Connected as ${one.account}` : ""}
                      </Button>
                    ))}
                <Field>
                  <FieldLabel htmlFor="account-folder">
                    Profile folder
                  </FieldLabel>
                  <Input
                    id="account-folder"
                    value={folder}
                    onChange={(event) => setFolder(event.target.value)}
                    placeholder="/absolute/path/on/this/machine"
                  />
                  <FieldDescription>
                    On the machine running Banda’s engine. Its credentials stay
                    in place.
                  </FieldDescription>
                </Field>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Banda creates a private profile for this account. Sign in with
                your subscription in the last step.
              </p>
            )}
          </FieldGroup>
        )}
        {step === 1 && (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="account-name">Account name</FieldLabel>
              <Input
                id="account-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
              />
            </Field>
            <Field>
              <FieldLabel>What is it for?</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {PURPOSES.map((purpose) => (
                  <Button
                    key={purpose.icon}
                    aria-label={`Use for ${purpose.name}`}
                    variant="outline"
                    onClick={() => {
                      setName(purpose.name)
                      setIcon(purpose.icon)
                    }}
                  >
                    {purpose.name}
                  </Button>
                ))}
              </div>
            </Field>
            <EmblemPicker
              harness={draft}
              onIcon={setIcon}
              onColour={setColour}
            />
          </FieldGroup>
        )}
        {step === 2 && made && (
          <>
            <p className="text-sm">
              {made.name} is connected. Verify its sign-in below, or finish
              later from its account page.
            </p>
            <AccountLogin
              engine={engine}
              harness={made.id}
              onRunning={setRunning}
            />
          </>
        )}
        {refused && <Problem>{refused}</Problem>}
        <DialogFooter>
          {step === 1 && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setStep(0)}
            >
              Back
            </Button>
          )}
          <Button variant="outline" disabled={busy || running} onClick={close}>
            {made ? "Done" : "Cancel"}
          </Button>
          {step === 0 && (
            <Button
              disabled={existing && !folder.trim()}
              onClick={() => setStep(1)}
            >
              Next
            </Button>
          )}
          {step === 1 && (
            <Button
              disabled={busy || !name.trim()}
              onClick={() => void create()}
            >
              {busy ? "Connecting…" : "Connect account"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function availableId(harness: string, taken: readonly HarnessView[]): string {
  let n = 2
  while (taken.some((one) => one.id === `${harness}-${n}`)) n++
  return `${harness}-${n}`
}
