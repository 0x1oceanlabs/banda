/**
 * Add an Account (ADR 0093; ADR 0078, decision 1): how it pays first, then
 * a subscription's profile, name, emblem and sign-in; an API key's name,
 * emblem and sign-in, which for Codex is its key; or a gateway's address
 * and key.
 */
import { useCallback, useState } from "react"
import {
  ChevronRightIcon,
  KeyRoundIcon,
  UserRoundIcon,
  WaypointsIcon,
} from "lucide-react"
import type { Engine } from "@banda/contract"
import type {
  AccountKind,
  AccountList,
  Adds,
  HarnessOf,
  HarnessView,
  Icon,
  Kept,
} from "@banda/contract/harnesses"
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@banda/ui/components/item"
import { Spinner } from "@banda/ui/components/spinner"
import { useRead } from "@banda/ui/hooks/use-read"
import { problem } from "@banda/ui/lib/words"
import { Problem } from "../thread/SignIn"
import { ApiKeyForm, GatewayForm, KEPT_WORDS } from "./AccountKeys"
import { AccountLogin } from "./AccountLogin"
import { EmblemPicker } from "./AccountPage"
import { KIND_WORDS } from "./accounts"

const PURPOSES: { name: string; icon: Icon }[] = [
  { name: "Work", icon: "work" },
  { name: "Personal", icon: "personal" },
  { name: "Team", icon: "team" },
  { name: "Client", icon: "client" },
  { name: "Spare", icon: "spare" },
  { name: "Experiments", icon: "experiments" },
]

type Step = "profile" | "name" | "sign-in" | "gateway"

/** The steps of each kind of account, in turn. */
const STEPS: Readonly<Record<AccountKind, readonly Step[]>> = {
  subscription: ["profile", "name", "sign-in"],
  api: ["name", "sign-in"],
  gateway: ["gateway"],
}

const STEP_WORDS: Readonly<Record<Step, string>> = {
  profile: "Choose an account",
  name: "Name and emblem",
  "sign-in": "Sign in",
  gateway: "Its address and key",
}

/** How an account of the Harness `title` pays, as the first step offers
 * it, in the words its machine says (`adds`). */
function kindsOf(title: string, adds: Adds) {
  const gateways = adds.gateways.map((gateway) => gateway.name)
  return [
    {
      kind: "subscription",
      about: `${adds.plans}. You sign in in a terminal, as in ${title} itself.`,
      Icon: UserRoundIcon,
    },
    {
      kind: "api",
      about: `Billed by the token ${adds.billed}. ${title} keeps the key.`,
      Icon: KeyRoundIcon,
    },
    {
      kind: "gateway",
      about: `${gateways.join(", ")} or your own address. Its key goes in this computer’s keyring.`,
      Icon: WaypointsIcon,
    },
  ] as const
}

export function AccountSetup({
  engine,
  base,
  of,
  answer,
  onClose,
}: {
  engine: Engine
  base: HarnessView
  /** What its machine says of its Harness: what a new account is called,
   * and how it adds one. */
  of: HarnessOf & { adds: Adds }
  /** What its machine says of its Accounts. */
  answer: AccountList
  onClose: () => void
}) {
  const { next: fresh, title, adds } = of
  const api = adds.api
  const [kind, setKind] = useState<AccountKind>()
  const [at, setAt] = useState(0)
  const [existing, setExisting] = useState(false)
  const [folder, setFolder] = useState("")
  const [name, setName] = useState(fresh.name)
  const [icon, setIcon] = useState(base.icon)
  const [colour, setColour] = useState(fresh.colour)
  const [made, setMade] = useState<HarnessView>()
  const [kept, setKept] = useState<Kept>()
  const [keyed, setKeyed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [refused, setRefused] = useState<string>()
  const readProfiles = useCallback(
    () => engine.call("harnesses.account_profiles", {}),
    [engine]
  )
  const profiles = useRead(kind === "subscription" ? readProfiles : null)
  const steps = kind ? STEPS[kind] : []
  const step = steps[at]
  const { id } = fresh
  const draft = { ...base, id, name, icon, colour, kind: kind ?? base.kind }
  const close = () => {
    if (!busy && !running) onClose()
  }
  const choose = (chosen: AccountKind) => {
    setKind(chosen)
    setAt(0)
    setExisting(false)
    setFolder("")
    setIcon(chosen === "api" ? "key" : base.icon)
  }
  const create = async () => {
    if (busy || !name.trim()) return
    setBusy(true)
    setRefused(undefined)
    try {
      const account = await engine.command("harnesses.connect_account", {
        harness: base.harness,
        id,
        name: name.trim(),
        colour,
        kind,
        ...(icon && { icon }),
        ...(existing && { folder: folder.trim() }),
      })
      setMade(account)
      setAt(at + 1)
    } catch (error) {
      setRefused(problem(error))
    } finally {
      setBusy(false)
    }
  }
  const madeWords = made && {
    subscription: `${made.name} is connected. Verify its sign-in below, or finish later from its account page.`,
    api:
      api.by === "key"
        ? `${made.name} is signed in with its key.`
        : `${made.name} is connected. Sign in to ${api.console} below: ${title} keeps the key.`,
    gateway: `${made.name} is added. ${kept ? KEPT_WORDS[kept] : ""}`,
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
          <DialogTitle>Add a {title} account</DialogTitle>
          <DialogDescription>
            {!step
              ? "How does this account pay?"
              : steps.length > 1
                ? `${at + 1} of ${steps.length} · ${STEP_WORDS[step]}`
                : `${KIND_WORDS[kind!]} ${made ? "added" : `· ${STEP_WORDS[step]}`}`}
          </DialogDescription>
        </DialogHeader>
        {!kind && (
          <ItemGroup className="gap-2">
            {kindsOf(title, adds).map((one) => (
              <Item
                key={one.kind}
                variant="outline"
                render={<button type="button" />}
                className="text-left hover:bg-muted"
                onClick={() => choose(one.kind)}
              >
                <ItemMedia variant="icon">
                  <one.Icon />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{KIND_WORDS[one.kind]}</ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    {one.about}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
        {step === "profile" && (
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
              <p className="text-ui text-muted-foreground">
                Banda creates a private profile for this account. Sign in with
                your subscription in the last step.
              </p>
            )}
          </FieldGroup>
        )}
        {step === "name" && (
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
        {step === "gateway" && !made && (
          <GatewayForm
            engine={engine}
            base={base}
            adds={adds}
            title={title}
            taken={answer.accounts}
            colour={colour}
            onBusy={setRunning}
            onAdded={(added) => {
              setMade(added.account)
              setKept(added.kept)
            }}
          />
        )}
        {made &&
          kind &&
          (kind === "api" && api.by === "key" && !keyed ? (
            <>
              <p className="text-ui">
                {made.name} is connected. Give it its {api.vendor} key.
              </p>
              <ApiKeyForm
                engine={engine}
                harness={made.id}
                title={title}
                vendor={api.vendor}
                onBusy={setRunning}
                onKept={() => setKeyed(true)}
              />
            </>
          ) : (
            <>
              <p className="text-ui">{madeWords?.[kind]}</p>
              <AccountLogin
                engine={engine}
                harness={made.id}
                onRunning={setRunning}
              />
            </>
          ))}
        {refused && <Problem>{refused}</Problem>}
        <DialogFooter>
          {kind && !made && (
            <Button
              variant="outline"
              disabled={busy || running}
              onClick={() => (at > 0 ? setAt(at - 1) : setKind(undefined))}
            >
              Back
            </Button>
          )}
          <Button variant="outline" disabled={busy || running} onClick={close}>
            {made ? "Done" : "Cancel"}
          </Button>
          {step === "profile" && (
            <Button
              disabled={existing && !folder.trim()}
              onClick={() => setAt(at + 1)}
            >
              Next
            </Button>
          )}
          {step === "name" && (
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
