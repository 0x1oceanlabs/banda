/**
 * The Fence row in General (ADR 0083): whether the fence around every
 * Harness holds on this computer, what a new Thread starts with then, and
 * what an Agent gets behind it and never gets; where it does not hold
 * whole, why, and the one fix there is. The mode menus' Learn more leads
 * here (`general/fence`).
 */
import type { Fence } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@banda/ui/components/collapsible"
import { CopyButton } from "@banda/ui/components/copy-button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from "@banda/ui/components/item"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { hasGaps, holdsWhole } from "@banda/ui/hooks/use-status"
import { isMac } from "@banda/ui/lib/keys"
import { cn } from "@banda/ui/lib/utils"
import {
  BellOffIcon,
  BotIcon,
  CrownIcon,
  ExternalLinkIcon,
  FolderIcon,
  GitBranchIcon,
  GlobeIcon,
  InfoIcon,
  KeyIcon,
  KeyRoundIcon,
  LockIcon,
  type LucideIcon,
  MonitorIcon,
  ShieldAlertIcon,
  TerminalIcon,
  UserXIcon,
} from "lucide-react"

/** Where the fence is told of at length. */
const DOCS = "https://github.com/0x1oceanlabs/banda/blob/main/docs/fence.md"

/** What an Agent behind the fence gets: what Full access means there. */
const GETS: [LucideIcon, string][] = [
  [FolderIcon, "Your files"],
  [TerminalIcon, "Your programs"],
  [GlobeIcon, "The network"],
  [
    KeyRoundIcon,
    "Your ssh-agent, in Projects you said you trust: it can git push and ssh as you",
  ],
  [
    GitBranchIcon,
    "Your GitHub token (from gh), in Projects you said you trust",
  ],
]

/** What an Agent behind the fence never gets. */
const NEVER: [LucideIcon, string][] = [
  [LockIcon, "Banda's own data and keys"],
  [UserXIcon, "Acting as you in Banda"],
  [KeyIcon, "Your keyring"],
  [MonitorIcon, "Your screen and clipboard"],
  [CrownIcon, "Becoming root (sudo)"],
  [BellOffIcon, "Desktop notifications (Banda still sends its own)"],
]

/** What every Agent runs inside, and what does not. */
const INSIDE = "Every Agent runs inside it; your Terminals don't."

/** What a new Thread starts with, unless the Person set its Harness's
 * mode in Settings → Agents (agents.toml's `[start.<id>]`). */
const starts = (mode: string) =>
  `New Threads start ${mode}, unless you set another mode for them.`

/** What a new Thread starts with where the fence does not hold whole. */
const SUPERVISED = starts("Supervised")

/**
 * Lets Banda's engine copies use user namespaces where Ubuntu's AppArmor
 * keeps them from apps it has no profile for, as Ubuntu's own profiles
 * for browsers do: Banda's, Banda Dev's and a local Banda's copies, as the
 * window puts them in `<data>/engine/<version>/`.
 */
const APPARMOR = `sudo tee /etc/apparmor.d/banda <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile banda @{HOME}/.local/share/banda*/engine/*/banda flags=(unconfined) {
  userns,
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/banda`

/** How the fence stands, as the row draws it. */
type Shown = {
  /** The word at the row's end: on, partly or off. */
  word: "on" | "partly" | "off"
  /** Its layers, over that word. */
  layers: string
  /** The row's description, two lines at most. */
  about: string
  /** Something to do about it, or to know, under the description. */
  more?: React.ReactNode
  /** What an Agent gets and never gets, when it holds at all; `caveat`
   * when it holds with gaps. */
  lists?: { kept: boolean; caveat?: string }
}

function shownOf(fence: Fence, quit: string): Shown {
  if (fence.fence === "holds") {
    const layers = fence.layers
      .map((layer) => (layer === "landlock" ? "Landlock" : layer))
      .join(", ")
    if (hasGaps(fence))
      return {
        word: "partly",
        layers,
        about: `Partly. This Linux lacks a part the fence needs, so it has gaps. ${SUPERVISED}`,
        more: (
          <>
            {fence.docker_group && (
              <Attention>
                You're in the docker group too. Through Docker, an Agent could
                step past the fence.
              </Attention>
            )}
            <Note icon={InfoIcon}>
              Linux 6.12 or later, with Landlock on, closes the gaps.
            </Note>
          </>
        ),
        lists: {
          kept: true,
          caveat: fence.docker_group
            ? "Through Docker, or the gaps, it could still get these."
            : "With the gaps, it may still get some of these.",
        },
      }
    if (fence.docker_group)
      return {
        word: "on",
        layers,
        about: `On. ${INSIDE}`,
        more: (
          <Attention>
            You're in the docker group. Through Docker, an Agent could step past
            the fence, so new Threads start Supervised. Leave the group, or use
            rootless Docker, and they start Full access again.
          </Attention>
        ),
        lists: {
          kept: true,
          caveat: "Through Docker, it could still get these.",
        },
      }
    return {
      word: "on",
      layers,
      about: `On. ${INSIDE} ${starts("Full access")}`,
      lists: { kept: false },
    }
  }
  const off = (why: string, more?: React.ReactNode, then = SUPERVISED) => ({
    word: "off" as const,
    layers: "none",
    about: `Off. ${why} ${then}`,
    more,
  })
  switch (fence.why) {
    case "apparmor":
      return off(
        "Ubuntu doesn't let apps use user namespaces, which the fence needs.",
        <>
          <p className="text-xs">
            Run this once in a Terminal to let Banda use them. Then quit Banda
            {quit && ` (${quit})`} and open it again.
          </p>
          <Copyable text={APPARMOR} label="Copy the command" />
        </>
      )
    case "no_user_namespaces":
    case "refused":
      return off(
        "This computer doesn't allow user namespaces, which the fence needs."
      )
    case "unsupported_os":
      return isMac
        ? off(
            "Banda has no fence for macOS yet.",
            <Note icon={InfoIcon}>A later Banda brings it here.</Note>
          )
        : off("Banda has no fence for Windows.")
    case "not_built":
      // That engine starts new Threads as it did before the fence.
      return off(
        "Banda's engine is from before the fence and gets it when it starts again.",
        <Note icon={InfoIcon}>
          Quit Banda{quit && ` (${quit})`} and open it again to start it now.
        </Note>,
        "Until then, new Threads start as they did."
      )
    case "off":
      return off("It is turned off for testing (BANDA_FENCE=off).")
    case "setup_failed":
      return off(
        "Banda couldn't set it up here.",
        <Details words={fence.words} />
      )
  }
}

/** What the engine said as it could not set the fence up: for a report of
 * it, not to read. */
function Details({ words }: { words: string }) {
  return (
    <Collapsible className="flex min-w-0 flex-col gap-1.5">
      <CollapsibleTrigger className="group self-start text-xs text-muted-foreground hover:text-foreground">
        <span className="group-data-panel-open:hidden">▸</span>
        <span className="hidden group-data-panel-open:inline">▾</span> Details
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Copyable text={words} label="Copy the details" />
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Text to take as it is, with its copy button: a command to run, or
 * what the engine found. */
function Copyable({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <code className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap select-text">
        {text}
      </code>
      <CopyButton text={text} label={label} />
    </div>
  )
}

export function FenceRow({
  fence,
  lit,
  onAgents,
}: {
  fence: Fence
  /** A link named it: it shows lit. */
  lit: boolean
  /** Opens Settings → Agents, where each Harness's new Threads' mode is. */
  onAgents?: () => void
}) {
  const quit = useKeyLabel()("banda.quit") ?? ""
  const shown = shownOf(fence, quit)
  const whole = holdsWhole(fence)
  return (
    <Item
      data-key="fence"
      className={cn(
        "rounded-none px-4 transition-colors",
        lit && "bg-accent/60"
      )}
    >
      <ItemContent>
        <ItemTitle>Fence</ItemTitle>
        <ItemDescription className="text-xs">{shown.about}</ItemDescription>
      </ItemContent>
      <ItemActions
        className="font-mono text-xs text-muted-foreground"
        title={shown.layers}
      >
        {shown.word}
      </ItemActions>
      <ItemFooter className="min-w-0 flex-col items-stretch gap-2.5">
        {shown.more}
        {shown.word === "off" && (
          <Note icon={ShieldAlertIcon}>
            In Full access, an Agent is you, in Banda too. Supervised asks
            before it changes anything.
          </Note>
        )}
        {shown.lists && <Lists {...shown.lists} />}
        <div className="-ml-2.5 flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => window.open(DOCS, "_blank", "noopener,noreferrer")}
          >
            How it works
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
          {!whole && onAgents && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={onAgents}
            >
              <BotIcon data-icon="inline-start" />
              New Threads' mode
            </Button>
          )}
        </div>
      </ItemFooter>
    </Item>
  )
}

/** What an Agent gets, and what it never gets, side by side; "Kept from
 * it" where the fence has a way around it. */
function Lists({ kept, caveat }: { kept: boolean; caveat?: string }) {
  return (
    <div className="grid gap-x-6 gap-y-2 border-t pt-2.5 @xl:grid-cols-2">
      <List title="An Agent gets" items={GETS} />
      <div>
        <List title={kept ? "Kept from it" : "It never gets"} items={NEVER} />
        {caveat && <p className="mt-1.5 text-xs text-attention">{caveat}</p>}
      </div>
    </div>
  )
}

function List({
  title,
  items,
}: {
  title: string
  items: [LucideIcon, string][]
}) {
  return (
    <div>
      <h5 className="mb-1 text-xs font-medium text-muted-foreground">
        {title}
      </h5>
      <ul aria-label={title}>
        {items.map(([Icon, words]) => (
          <li key={words} className="flex items-start gap-2 py-0.75 text-xs">
            <Icon className="mt-px size-3.5 shrink-0 text-muted-foreground" />
            <span>{words}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Something to know that stops nothing. */
function Note({
  icon: Icon,
  children,
}: {
  icon: LucideIcon
  children: React.ReactNode
}) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Icon className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** What waits on the Person: in attention's colour, as the bar's update
 * says it. */
function Attention({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="flex gap-2 rounded-md bg-attention/10 px-2.5 py-2 text-xs text-attention"
    >
      <span
        aria-hidden
        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-attention"
      />
      <span>{children}</span>
    </p>
  )
}
