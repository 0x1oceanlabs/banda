import type {
  HarnessOption,
  Mode,
  Offer,
  Settings,
} from "@bandaso/contract/agents"
import { Button } from "@bandaso/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@bandaso/ui/components/dropdown-menu"
import {
  ChevronDownIcon,
  ListTodoIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldEllipsisIcon,
  ShieldIcon,
  type LucideIcon,
} from "lucide-react"
import { choose, chosen } from "./thread"

/** The modes in the order of how freely the Agent acts (ADR 0003, decision 9). */
const MODES: { mode: Mode; name: string; about: string; icon: LucideIcon }[] = [
  {
    mode: "supervised",
    name: "Supervised",
    about: "Asks before it changes anything.",
    icon: ShieldIcon,
  },
  {
    mode: "accept_edits",
    name: "Auto-accept edits",
    about: "Edits files without asking, and asks before anything else.",
    icon: ShieldCheckIcon,
  },
  {
    mode: "auto",
    name: "Auto",
    about: "Decides itself what to ask about.",
    icon: ShieldEllipsisIcon,
  },
  {
    mode: "full_access",
    name: "Full access",
    about: "Never asks.",
    icon: ShieldAlertIcon,
  },
]

/** What a Thread runs with, under its message box: the Harness's options,
 * the model first, then Plan and the mode. A change goes to `onChange`. */
export function SettingsBar({
  settings,
  offer,
  disabled,
  onChange,
}: {
  settings: Settings
  offer: Offer
  disabled: boolean
  onChange: (settings: Settings) => void
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
      <Modes settings={settings} disabled={disabled} onChange={onChange} />
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
  const value = chosen(settings, option)
  const now = option.choices.find((choice) => choice.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`${option.name}: ${now?.name ?? String(value)}`}
          />
        }
      >
        {now?.name ?? String(value)}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-auto min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{option.name}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next: string) =>
              onChange(choose(settings, option.id, next))
            }
          >
            {option.choices.map((choice) => (
              <DropdownMenuRadioItem
                key={choice.value}
                value={choice.value}
                closeOnClick
              >
                <span className="flex flex-col">
                  <span>{choice.name}</span>
                  {choice.description && (
                    <span className="text-xs text-muted-foreground">
                      {choice.description}
                    </span>
                  )}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
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
}: {
  settings: Settings
  disabled: boolean
  onChange: (settings: Settings) => void
}) {
  const now = MODES.find((m) => m.mode === settings.mode) ?? MODES[3]
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
        <DropdownMenuGroup>
          <DropdownMenuLabel>How freely it acts</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={settings.mode}
            onValueChange={(mode: Mode) => onChange({ ...settings, mode })}
          >
            {MODES.map(({ mode, name, about, icon: Icon }) => (
              <DropdownMenuRadioItem key={mode} value={mode} closeOnClick>
                <Icon />
                <span className="flex flex-col">
                  <span>{name}</span>
                  <span className="text-xs text-muted-foreground">{about}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
