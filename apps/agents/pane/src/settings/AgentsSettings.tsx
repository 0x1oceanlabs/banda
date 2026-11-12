import { useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { HarnessView } from "@banda/contract/harnesses"
import { tomlOf } from "@banda/contract/settings"
import { Button } from "@banda/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@banda/ui/components/card"
import {
  Dialog,
  DialogClose,
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
import { Emblem } from "@banda/ui/components/emblem"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@banda/ui/components/select"
import { Input } from "@banda/ui/components/input"
import { Spinner } from "@banda/ui/components/spinner"
import { useAccountList } from "@banda/ui/hooks/use-harnesses"
import { useWrite } from "@banda/ui/hooks/use-write"
import { PlusIcon } from "lucide-react"
import {
  type StartsOn,
  startsOnWords,
  useLimitsNow,
  useStartsOn,
} from "../thread/starts-on"
import { wordsOf } from "../thread/sign-in"
import { type Open, Problem } from "../thread/SignIn"
import { AccountCard, HarnessGroup } from "./AccountCards"
import { AccountSetup } from "./AccountSetup"
import { AccountPage, Row, type Roles } from "./AccountPage"
import { groupsOf, pickStart, useUses } from "./accounts"

/** Where the window's settings say why a new Thread starts Supervised. */
export { FENCE_LINK } from "./fence"

/**
 * A settings file, as the settings Pane writes it (ADR 0016): through
 * `banda settings`, which keeps the Person's text and refuses what the
 * engine would not read. Each answers what was wrong, or nothing.
 */
export type SettingsFile = {
  /** Sets `key`, as `harness.codex.enabled`, to a TOML value. */
  set: (key: string, value: string) => Promise<string[]>
  /** Takes `key` out; in `harnesses.toml`, `harness.codex` takes the
   * whole entry out. */
  reset: (key: string) => Promise<string[]>
  /** Opens the file in the Person's editor. */
  reveal: () => void
}

export type Props = {
  engine: Engine
  /** A Project, where there is one: what a new Thread starts with is
   * offered in it, and a sign-in in a terminal runs there. */
  project?: ProjectId
  open: Open
  harnesses: SettingsFile
  /** What a new Thread on each Harness starts with is here. */
  agents: SettingsFile
  /** Opens Settings → General at the Fence row, which says why a new
   * Thread starts Supervised (ADR 0083). */
  onFence: () => void
}

/** The Harness a new entry is an account of, or none for a Harness of
 * its own. */
type Adding = { of?: { harness: string; name: string } }

/**
 * The settings Pane's Agents (ADR 0016, decision 7; ADR 0093, decision 9):
 * New Threads on top, where a new Thread starts; then the accounts as
 * cards by Harness, each Harness ending with an Add card. A card opens the
 * account's page, and so does a link that names its entry. The Harnesses
 * and their accounts are the machine's module `harnesses` (ADR 0040), so
 * they show with no Project, as that machine says them and as it tells
 * they changed, by hand too (ADR 0108, decision 4). What a message written
 * while an Agent works does is `agents.toml`'s, drawn from its schema under
 * these.
 */
export function AgentsSettings({
  lit,
  ...props
}: Props & {
  /** A link's entry: its page opens. */
  lit?: string
}) {
  const { engine } = props
  const live = useAccountList(engine)
  // A new link opens its entry's page.
  const [opened, setOpened] = useState({ lit, id: lit })
  if (opened.lit !== lit) setOpened({ lit, id: lit })
  const open = (id: string | undefined) => setOpened({ lit, id })
  const [adding, setAdding] = useState<Adding>()
  const starts = useStartsOn(engine)
  const { limits, now } = useLimitsNow(engine)
  const uses = useUses(engine)
  if (live.state === "loading") return <Spinner />
  if (live.state === "refused") return <Problem>{live.refusal.message}</Problem>
  const answer = live.view
  const list = answer.accounts
  const on = list.filter((one) => one.enabled)
  const roles: Roles = { default: answer.default, fallback: answer.fallback }
  const groups = groupsOf(answer)
  const shown = list.find((one) => one.id === opened.id)
  const of = (one: HarnessView) =>
    groups.find((group) => group.harness === one.harness)!.name
  const limitsOf = (id: string) => limits.find((l) => l.harness === id)
  if (shown)
    return (
      <AccountPage
        {...props}
        harness={shown}
        of={of(shown)}
        limits={limitsOf(shown.id)}
        now={now}
        use={uses?.get(shown.id)}
        roles={roles}
        onBack={() => open(undefined)}
      />
    )
  return (
    <div className="flex flex-col gap-5">
      {answer.default !== undefined && (
        <StartAccounts
          starts={starts}
          on={on}
          chosen={{ ...roles, default: answer.default }}
          engine={engine}
        />
      )}
      {groups.map(({ harness, name, accounts }) => (
        <HarnessGroup
          key={harness}
          name={name}
          onAdd={() => setAdding({ of: { harness, name } })}
        >
          {accounts.map((one) => (
            <AccountCard
              key={one.id}
              engine={engine}
              harness={one}
              limits={limitsOf(one.id)}
              now={now}
              use={uses?.get(one.id)}
              roles={roles}
              onOpen={() => open(one.id)}
            />
          ))}
        </HarnessGroup>
      ))}
      <Button
        variant="outline"
        className="h-auto min-h-9 justify-start border-dashed text-left whitespace-normal text-muted-foreground"
        onClick={() => setAdding({})}
      >
        <PlusIcon />
        Add a Harness: any agent that speaks ACP
      </Button>
      {adding?.of && ["claude", "codex"].includes(adding.of.harness) ? (
        <AccountSetup
          engine={engine}
          base={list.find((one) => one.harness === adding.of!.harness)!}
          answer={answer}
          onClose={() => setAdding(undefined)}
        />
      ) : (
        <AddEntry
          file={props.harnesses}
          taken={list}
          adding={adding}
          onClose={() => setAdding(undefined)}
        />
      )}
    </div>
  )
}

/** None: the select's value for no fallback. */
const NO_FALLBACK = "none"

/**
 * Where a new Thread starts (ADR 0093, decision 7): the default account,
 * and the fallback it starts on while the default is out, of any Harness,
 * as the machine names them. Under them, where new Threads start now,
 * while the default is out.
 */
function StartAccounts({
  starts,
  on,
  chosen,
  engine,
}: {
  starts: StartsOn | undefined
  /** The entries that are on. */
  on: readonly HarnessView[]
  chosen: { default: string; fallback?: string }
  engine: Engine
}) {
  const { refused, write } = useWrite()
  const now = starts && startsOnWords(starts, on)
  return (
    <Card size="sm" role="group" aria-label="New Threads">
      <CardHeader>
        <CardTitle>New Threads</CardTitle>
        <CardDescription>
          Which account a new Thread starts on. A Thread that runs stays on its
          account: when it is out, its card offers the fallback.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y border-t">
        <Row title="Default" about="Where a new Thread starts.">
          <AccountSelect
            label="Default account"
            value={chosen.default}
            accounts={on}
            onChange={(id) => write(pickStart(engine, "account", id))}
          />
        </Row>
        <Row
          title="Fallback"
          about="Where a new Thread starts while the default is out of its limits, if it has room. It may be another Harness's."
        >
          <AccountSelect
            label="Fallback account"
            value={chosen.fallback ?? NO_FALLBACK}
            accounts={on.filter((one) => one.id !== chosen.default)}
            none="None"
            onChange={(id) =>
              write(
                pickStart(
                  engine,
                  "fallback",
                  id === NO_FALLBACK ? undefined : id
                )
              )
            }
          />
        </Row>
        {now && (
          <p role="status" className="py-2 text-meta text-warning">
            {now}
          </p>
        )}
        {refused.map((message) => (
          <Problem key={message}>{message}</Problem>
        ))}
      </CardContent>
    </Card>
  )
}

/** A choice of one of `accounts`, each by its emblem and name; with
 * `none`, of none of them too. */
function AccountSelect({
  label,
  value,
  accounts,
  none,
  onChange,
}: {
  label: string
  value: string
  accounts: readonly HarnessView[]
  none?: string
  onChange: (id: string) => void
}) {
  const named = (id: string) => {
    const one = accounts.find((account) => account.id === id)
    return one ? <Emblem of={one} named /> : none
  }
  return (
    <Select value={value} onValueChange={(id) => onChange(id as string)}>
      <SelectTrigger aria-label={label} className="min-w-44">
        <SelectValue>{named}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {none && <SelectItem value={NO_FALLBACK}>{none}</SelectItem>}
        {accounts.map((one) => (
          <SelectItem key={one.id} value={one.id}>
            <Emblem of={one} named />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * A new entry in `harnesses.toml`: any agent that speaks ACP, by its
 * command, or another account of a Harness, which takes its program. The
 * steps of Add account, its folder made and signed in, come later
 * (ADR 0093, decision 9).
 */
function AddEntry({
  file,
  taken,
  adding,
  onClose,
}: {
  file: SettingsFile
  taken: HarnessView[]
  adding: Adding | undefined
  onClose: () => void
}) {
  const of = adding?.of
  const [name, setName] = useState("")
  const [id, setId] = useState<string>()
  const [line, setLine] = useState("")
  const wanted = id ?? idOf(name)
  const [command, ...args] = wordsOf(line)
  const wrong = !/^[a-z0-9][a-z0-9-]*$/.test(wanted)
    ? "An ID is small letters, digits and dashes."
    : taken.some((h) => h.id === wanted)
      ? `There is a Harness with the ID ${wanted} already.`
      : undefined
  const ready =
    !wrong && (of !== undefined || command !== undefined) && name.trim() !== ""
  const close = () => {
    setName("")
    setId(undefined)
    setLine("")
    onClose()
  }
  const { refused, write } = useWrite({ onWritten: close })
  const add = () => {
    if (!ready) return
    const named = `name = ${tomlOf(name.trim())}`
    const entry = of
      ? `{ ${named}, of = ${tomlOf(of.harness)} }`
      : `{ ${named}, command = ${tomlOf(command!)}, args = ${tomlOf(args)} }`
    write(file.set(`harness.${wanted}`, entry))
  }
  const title = of ? `Add a ${of.name} account` : "Add a Harness"
  return (
    <Dialog
      open={adding !== undefined}
      onOpenChange={(open) => !open && close()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {of
              ? `A new entry in harnesses.toml that runs ${of.name}. To sign in to another account, give it a config folder of its own in its environment there (CLAUDE_CONFIG_DIR or CODEX_HOME).`
              : "A new entry in harnesses.toml: an agent's program that speaks ACP."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="harness-name">Name</FieldLabel>
              <Input
                id="harness-name"
                value={name}
                placeholder={of ? "Work" : "Gemini CLI"}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="harness-id">ID</FieldLabel>
              <Input
                id="harness-id"
                value={wanted}
                onChange={(event) => setId(event.target.value)}
                className="font-mono"
              />
              <FieldDescription>
                How Threads name it. It stays: a Thread keeps the ID.
              </FieldDescription>
            </Field>
            {!of && (
              <Field>
                <FieldLabel htmlFor="harness-command">Command</FieldLabel>
                <Input
                  id="harness-command"
                  value={line}
                  placeholder="npx -y @google/gemini-cli --experimental-acp"
                  onChange={(event) => setLine(event.target.value)}
                  className="font-mono"
                />
                <FieldDescription>
                  The program that speaks ACP on its stdio, then its arguments.
                </FieldDescription>
              </Field>
            )}
            {name && wrong && <Problem>{wrong}</Problem>}
            {refused.map((message) => (
              <Problem key={message}>{message}</Problem>
            ))}
          </FieldGroup>
          <DialogFooter className="mt-4">
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={!ready}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** `Gemini CLI` as `gemini-cli`. */
function idOf(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
}
