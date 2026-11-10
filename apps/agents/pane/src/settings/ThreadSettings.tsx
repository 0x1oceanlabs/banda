import type { Fence } from "@banda/contract"
import type {
  HarnessOption,
  Mode,
  Offer,
  Settings,
} from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import {
  ChevronDownIcon,
  CircleAlertIcon,
  InfoIcon,
  ListTodoIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldEllipsisIcon,
  ShieldIcon,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@banda/ui/lib/utils"
import { FOOTER_CONTROL } from "../composer/Composer"
import { choose, chosen } from "../thread/state"
import { fullAccessAbout, reasonOf, warns } from "./fence"

/** The modes in the order of how freely the Agent acts (ADR 0003,
 * decision 9); `short`, the word the composer's footer shows for a name
 * too long for it. What Full access means follows the fence
 * (`fullAccessAbout`). */
const MODES: (Choice & { id: Mode; icon: LucideIcon; short?: string })[] = [
  {
    id: "supervised",
    name: "Supervised",
    about: "Asks before it changes anything.",
    icon: ShieldIcon,
  },
  {
    id: "accept_edits",
    name: "Auto-accept edits",
    short: "Accept edits",
    about: "Edits files without asking, and asks before anything else.",
    icon: ShieldCheckIcon,
  },
  {
    id: "auto",
    name: "Auto",
    about: "Decides itself what to ask about.",
    icon: ShieldEllipsisIcon,
  },
  {
    id: "full_access",
    name: "Full access",
    icon: ShieldAlertIcon,
  },
]

/** A menu that floats as the chat's popups do (ADR 0058): a block's
 * corner over the menu's own fill, ring and shadow. */
const MENU = "rounded-card shadow-md"
/** A row of such a menu: a button's corner, room around its words. */
const ROW = "py-1.5 pl-2.5"

/** A choice in a menu: its icon, its name, and what it means under it. */
export type Choice = {
  id: string
  name: string
  about?: string
  icon?: LucideIcon
  /** What stands before its name instead of an icon, as a Project's sign. */
  mark?: React.ReactNode
}

/** `choices` as a menu's radio items, `value` checked. */
function ChoiceItems({
  value,
  choices,
  onChange,
}: {
  value: string
  choices: Choice[]
  onChange: (id: string) => void
}) {
  return (
    <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
      {choices.map(({ id, name, about, icon: Icon, mark }) => (
        <DropdownMenuRadioItem key={id} value={id} closeOnClick className={ROW}>
          {mark ?? (Icon && <Icon />)}
          <span className="flex flex-col">
            <span className="font-medium">{name}</span>
            {about && (
              <span className="text-xs text-muted-foreground">{about}</span>
            )}
          </span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/** The mode `settings` name, as {@link MODES} words it; one this window
 * does not know reads as Supervised, the mode that asks. */
function modeOf(settings: Settings) {
  return MODES.find((m) => m.id === settings.mode) ?? MODES[0]
}

/** What the mode menus are told of the fence (ADR 0083): how it stands,
 * and what Learn more under the modes does. */
type FenceShown = {
  fence: Fence | undefined
  /** Opens Settings → General at the Fence row. */
  onLearn: () => void
}

/** A Harness's option's choices, as a menu shows them. */
function choicesOf(option: HarnessOption): Choice[] {
  return option.choices.map((choice) => ({
    id: choice.value,
    name: choice.name,
    about: choice.description,
  }))
}

/** The name of the choice `value` is, or `value` if none is. */
function nameOf(choices: Choice[], value: string): string {
  return choices.find((choice) => choice.id === value)?.name ?? value
}

/**
 * How freely a Thread's Agent acts, as a quiet shield beside the model
 * picker, as Codex shows its permissions (ADR 0031): the mode's icon, its
 * word too once the Thread is wide enough (ADR 0058), and a menu of the
 * modes. The Harness's options the picker does not set are in it too.
 * Plan is not: `/plan`, `/default` and Shift+Tab switch it.
 */
export function ModeMenu({
  settings,
  options,
  disabled,
  onChange,
  fence,
}: {
  settings: Settings
  /** The Harness's options the model picker leaves out. */
  options: HarnessOption[]
  disabled: boolean
  onChange: (settings: Settings) => void
  fence: FenceShown
}) {
  const mode = modeOf(settings)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn(FOOTER_CONTROL, "px-[7px] @min-[40rem]/thread:px-2")}
            aria-label={`Mode: ${mode.name}`}
            title={mode.name}
          />
        }
      >
        <mode.icon />
        <span className="hidden @min-[40rem]/thread:inline">
          {mode.short ?? mode.name}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        className={cn("w-auto min-w-64", MENU)}
      >
        <ModeItems settings={settings} onChange={onChange} fence={fence} />
        {options.length > 0 && <DropdownMenuSeparator />}
        {options.map((option) =>
          option.choices.length > 0 ? (
            <Submenu
              key={option.id}
              what={option.name}
              value={String(chosen(settings, option))}
              choices={choicesOf(option)}
              onChange={(next) => onChange(choose(settings, option.id, next))}
            />
          ) : (
            <DropdownMenuCheckboxItem
              key={option.id}
              className={ROW}
              checked={chosen(settings, option) === true}
              onCheckedChange={(on) =>
                onChange(choose(settings, option.id, on))
              }
            >
              {option.name}
            </DropdownMenuCheckboxItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One option in {@link ModeMenu}: its name, what is chosen, and the
 * choices beside. */
function Submenu({
  what,
  value,
  choices,
  onChange,
}: {
  what: string
  value: string
  choices: Choice[]
  onChange: (id: string) => void
}) {
  const now = nameOf(choices, value)
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        aria-label={`${what}: ${now}`}
        className="px-2.5 py-1.5"
      >
        <span className="flex-1">{what}</span>
        <span className="pl-4 text-muted-foreground">{now}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={cn("min-w-48", MENU)}>
        <ChoiceItems value={value} choices={choices} onChange={onChange} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** What a Thread runs with, under its message box: the Harness's options,
 * the model first, then Plan and the mode. A change goes to `onChange`. */
export function SettingsBar({
  settings,
  offer,
  disabled,
  onChange,
  fence,
}: {
  settings: Settings
  offer: Offer
  disabled: boolean
  onChange: (settings: Settings) => void
  fence: FenceShown
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-0.5">
      {offer.options.map((option) =>
        option.choices.length > 0 ? (
          <Choices
            key={option.id}
            option={option}
            settings={settings}
            disabled={disabled}
            onChange={onChange}
          />
        ) : (
          <Switch
            key={option.id}
            name={option.name}
            on={chosen(settings, option) === true}
            disabled={disabled}
            onChange={(on) => onChange(choose(settings, option.id, on))}
          />
        )
      )}
      {offer.plans && (
        <Switch
          name="Plan"
          icon={ListTodoIcon}
          on={settings.plan}
          disabled={disabled}
          onChange={(plan) => onChange({ ...settings, plan })}
        />
      )}
      <Modes
        settings={settings}
        disabled={disabled}
        onChange={onChange}
        fence={fence}
      />
    </div>
  )
}

function Choices({
  option,
  settings,
  disabled,
  onChange,
}: {
  option: HarnessOption
  settings: Settings
  disabled: boolean
  onChange: (settings: Settings) => void
}) {
  return (
    <Pick
      what={option.name}
      value={String(chosen(settings, option))}
      choices={choicesOf(option)}
      disabled={disabled}
      onChange={(next) => onChange(choose(settings, option.id, next))}
    />
  )
}

/** Choices of their own in a menu, under their label, as another
 * machine's Projects. */
export type ChoiceGroup = {
  key: string
  label: React.ReactNode
  choices: Choice[]
}

/** One of a few choices, as a menu that opens above the message box. */
export function Pick({
  what,
  icon,
  value,
  choices,
  groups = [],
  after,
  disabled,
  onChange,
  more,
}: {
  what: string
  icon?: React.ReactNode
  value: string
  choices: Choice[]
  /** More choices after `choices`, each group under its label. */
  groups?: readonly ChoiceGroup[]
  /** What follows the name on the button, and its words in the button's
   * name, as the other machine a Project is on. */
  after?: { mark: React.ReactNode; words: string }
  disabled: boolean
  onChange: (id: string) => void
  /** One more row after the choices, which does rather than picks. */
  more?: { title: string; icon: React.ReactNode; run: () => void }
}) {
  const now = nameOf(
    [...choices, ...groups.flatMap((group) => group.choices)],
    value
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="font-normal"
            aria-label={`${what}: ${now}${after ? ` ${after.words}` : ""}`}
          />
        }
      >
        {icon}
        {now}
        {after?.mark}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className={cn("w-auto min-w-48", MENU)}>
        {/* Beside groups, the first choices go with no heading, as this
            machine's Projects have no label beside another's: one would
            read as theirs. They keep the name for those who hear it. */}
        <DropdownMenuGroup aria-label={groups.length > 0 ? what : undefined}>
          {groups.length === 0 && (
            <DropdownMenuLabel className="px-2.5">{what}</DropdownMenuLabel>
          )}
          <ChoiceItems value={value} choices={choices} onChange={onChange} />
        </DropdownMenuGroup>
        {groups.map((group) => (
          <DropdownMenuGroup key={group.key}>
            <DropdownMenuLabel className="flex items-center gap-1.5 px-2.5 pt-2 font-normal">
              {group.label}
            </DropdownMenuLabel>
            <ChoiceItems
              value={value}
              choices={group.choices}
              onChange={onChange}
            />
          </DropdownMenuGroup>
        ))}
        {more && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="px-2.5 py-1.5" onClick={more.run}>
              {more.icon}
              {more.title}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Switch({
  name,
  icon: Icon,
  on,
  disabled,
  onChange,
}: {
  name: string
  icon?: LucideIcon
  on: boolean
  disabled: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <Button
      type="button"
      variant={on ? "outline" : "ghost"}
      size="xs"
      className={on ? "text-foreground" : undefined}
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      {Icon && <Icon data-icon="inline-start" />}
      {name}
    </Button>
  )
}

function Modes({
  settings,
  disabled,
  onChange,
  fence,
}: {
  settings: Settings
  disabled: boolean
  onChange: (settings: Settings) => void
  fence: FenceShown
}) {
  const now = modeOf(settings)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`Mode: ${now.name}`}
          />
        }
      >
        <now.icon data-icon="inline-start" />
        {now.name}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-auto min-w-64">
        <ModeItems settings={settings} onChange={onChange} fence={fence} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The modes, as a menu's group, the one in `settings` checked; Full
 * access says what it means with the fence as it stands. Where the fence
 * does not hold whole, one item under them says why, and leads to the
 * Fence row in Settings → General (ADR 0083).
 */
function ModeItems({
  settings,
  onChange,
  fence: { fence, onLearn },
}: {
  settings: Settings
  onChange: (settings: Settings) => void
  fence: FenceShown
}) {
  const choices = MODES.map((mode) =>
    mode.id === "full_access"
      ? { ...mode, about: fullAccessAbout(fence) }
      : mode
  )
  const reason = reasonOf(fence)
  const Icon = warns(fence) ? CircleAlertIcon : InfoIcon
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel className="px-2.5">
          How freely it acts
        </DropdownMenuLabel>
        <ChoiceItems
          value={settings.mode}
          choices={choices}
          onChange={(mode) => onChange({ ...settings, mode: mode as Mode })}
        />
      </DropdownMenuGroup>
      {reason && (
        <>
          <DropdownMenuSeparator />
          {/* Wraps within the menu's width, never widening it. */}
          <DropdownMenuItem
            className="w-0 min-w-full items-start py-1.5 pl-2.5 text-xs text-muted-foreground"
            title="Settings → General → Fence"
            onClick={onLearn}
          >
            <Icon className="mt-px size-3.5" />
            <span>
              {reason}{" "}
              <span className="whitespace-nowrap text-foreground">
                Learn more
              </span>
            </span>
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}
