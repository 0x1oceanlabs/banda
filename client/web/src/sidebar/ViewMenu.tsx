import type { ReactNode } from "react"
import type { JsonValue } from "@banda/contract"
import type { Sidebar } from "@banda/contract/sidebar"
import { Button } from "@banda/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { Separator } from "@banda/ui/components/separator"
import { Switch } from "@banda/ui/components/switch"
import { cn } from "@banda/ui/lib/utils"
import { FileCogIcon, ListFilterIcon } from "lucide-react"
import { device } from "../boot"
import { useLookSidebar } from "../look"
import { GROUP_WORDS, groupOf } from "./settings"
import { writeGroup, writeSidebar } from "./write-setting"

/** A choice of the view, a key of `sidebar.toml`, its options in words. */
type Choice = {
  label: string
  key: string
  options: readonly (readonly [JsonValue, string])[]
  value: (sidebar: Sidebar) => JsonValue
}

/** The view's choices, in the menu's order (ADR 0098, decisions 3, 7 and
 * 9): how the list is grouped, as it is drawn; how many lines a card
 * has; and Your turn's order. */
export const CHOICES: readonly Choice[] = [
  {
    label: "Group by",
    key: "group",
    options: Object.entries(GROUP_WORDS),
    value: groupOf,
  },
  {
    label: "Card",
    key: "card",
    options: [
      ["auto", "Auto"],
      [3, "3"],
      [2, "2"],
      [1, "1"],
    ],
    value: (sidebar) => sidebar.card,
  },
  {
    label: "Your turn first",
    key: "inbox.order",
    options: [
      ["oldest", "Oldest"],
      ["newest", "Newest"],
    ],
    value: (sidebar) => sidebar.inbox.order,
  },
]

/** The view's switches, each a key of `sidebar.toml` (decisions 3 and 6). */
export const SWITCHES: readonly {
  label: string
  key: string
  on: (sidebar: Sidebar) => boolean
}[] = [
  {
    label: "Open in the inbox",
    key: "inbox.open",
    on: (sidebar) => sidebar.inbox.open,
  },
  {
    label: "Working shelf in the inbox",
    key: "inbox.working",
    on: (sidebar) => sidebar.inbox.working,
  },
  {
    label: "Keep order under the pointer",
    key: "hold.still",
    on: (sidebar) => sidebar.hold.still,
  },
]

/**
 * The sidebar's view menu, in its foot (ADR 0098, decisions 7 and 21): how
 * the list is grouped, how many lines a card has, Your turn's order, and
 * what the Inbox shows and keeps still, each written into `sidebar.toml`
 * by the settings, whose look brings the list back so; and the file
 * itself, in the Person's editor.
 */
export function ViewMenu() {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="View"
            title="View"
            className="text-muted-foreground"
          >
            <ListFilterIcon />
          </Button>
        }
      />
      <PopoverContent
        side="top"
        align="start"
        aria-label="View"
        className="w-80 gap-0.5 p-2"
      >
        <ViewRows sidebar={useLookSidebar()} />
      </PopoverContent>
    </Popover>
  )
}

/** The view menu's rows for `sidebar` as the look has it. */
export function ViewRows({ sidebar }: { sidebar: Sidebar }) {
  const write = device.settings.set
  const pick = (key: string, value: JsonValue) => {
    if (key === "group") writeGroup(write, value as Sidebar["group"])
    else writeSidebar(write, key, value)
  }
  return (
    <>
      <div className="px-1 pb-1 text-meta text-muted-foreground">View</div>
      {CHOICES.map(({ label, key, options, value }) => (
        <Line key={key} label={label}>
          <div
            role="radiogroup"
            aria-label={label}
            className="inline-flex shrink-0 rounded-control bg-muted p-0.5"
          >
            {options.map(([option, words]) => {
              const picked = option === value(sidebar)
              return (
                <button
                  key={words}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  className={cn(
                    "h-6 rounded-small px-2 text-meta outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    picked
                      ? "bg-background text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => {
                    if (!picked) pick(key, option)
                  }}
                >
                  {words}
                </button>
              )
            })}
          </div>
        </Line>
      ))}
      <Separator className="my-1" />
      {SWITCHES.map(({ label, key, on }) => (
        <Line key={key} label={label}>
          <Switch
            label={label}
            on={on(sidebar)}
            onChange={(next) => pick(key, next)}
          />
        </Line>
      ))}
      <Separator className="my-1" />
      <button
        type="button"
        className="flex h-8 items-center gap-2 rounded-control px-1 text-left text-ui text-foreground/85 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => device.sidebar.edit()}
      >
        <FileCogIcon className="size-4 text-muted-foreground" />
        Edit sidebar.toml
      </button>
    </>
  )
}

/** One row of the view menu: its words on the left, its control on the
 * right. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 px-1">
      <span className="text-ui text-foreground/85">{label}</span>
      {children}
    </div>
  )
}
