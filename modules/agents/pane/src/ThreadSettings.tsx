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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
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
  return (
    <Pick
      what={option.name}
      value={String(chosen(settings, option))}
      choices={option.choices.map((choice) => ({
        id: choice.value,
        name: choice.name,
        about: choice.description,
      }))}
      disabled={disabled}
      onChange={(next) => onChange(choose(settings, option.id, next))}
    />
  )
}

/** One of a few choices, as a menu that opens above the message box. */
export function Pick({
  what,
  icon,
  value,
  choices,
  disabled,
  onChange,
}: {
  what: string
  icon?: React.ReactNode
  value: string
  choices: { id: string; name: string; about?: string }[]
  disabled: boolean
  onChange: (id: string) => void
}) {
  const now = choices.find((choice) => choice.id === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`${what}: ${now?.name ?? value}`}
          />
        }
      >
        {icon}
        {now?.name ?? value}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-auto min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{what}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {choices.map((choice) => (
              <DropdownMenuRadioItem
                key={choice.id}
                value={choice.id}
                closeOnClick
              >
                <span className="flex flex-col">
                  <span>{choice.name}</span>
                  {choice.about && (
                    <span className="text-xs text-muted-foreground">
                      {choice.about}
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
