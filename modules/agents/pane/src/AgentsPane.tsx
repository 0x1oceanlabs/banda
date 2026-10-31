import { useCallback, useMemo, useState } from "react"
import type { Engine, JsonValue, SpaceId } from "@bandaso/contract"
import type { AgentView, HarnessView } from "@bandaso/contract/agents"
import { Button } from "@bandaso/ui/components/button"
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@bandaso/ui/components/empty"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@bandaso/ui/components/field"
import { Input } from "@bandaso/ui/components/input"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@bandaso/ui/components/item"
import { ScrollArea } from "@bandaso/ui/components/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bandaso/ui/components/select"
import { Spinner } from "@bandaso/ui/components/spinner"
import { useAct } from "@bandaso/ui/hooks/use-act"
import { type Read, useRead } from "@bandaso/ui/hooks/use-read"
import { useLive } from "@bandaso/ui/hooks/use-live"
import { ago } from "@bandaso/ui/lib/words"
import {
  definePane,
  type PaneProps,
  type Place,
  paneOf,
} from "@bandaso/ui/pane"
import { BotIcon, PlusIcon, SquarePenIcon, UsersIcon } from "lucide-react"
import {
  AGENTS_FILTER,
  type AgentsState,
  applyAgents,
  readAgents,
  threadsOf,
} from "./agents"
import { threadPane } from "./ThreadPane"

type NoArgs = { [key: string]: JsonValue }

export const agentsPane = definePane<NoArgs>({
  kind: "agents.list",
  module: "agents",
  title: () => "Agents",
  icon: UsersIcon,
  start: {},
  narrow: true,
  Pane: AgentsPane,
})

/** How many of an Agent's Threads the list shows. */
const RECENT = 5

/** A click with Ctrl or ⌘ opens beside; a plain one reuses a Thread tile. */
function placeOf(event: React.MouseEvent): Place | undefined {
  return event.ctrlKey || event.metaKey ? "right" : undefined
}

function AgentsPane({ engine, space, open }: PaneProps<NoArgs>) {
  const source = useMemo(
    () => ({
      read: () => readAgents(engine, space),
      filter: AGENTS_FILTER,
      apply: applyAgents,
    }),
    [engine, space]
  )
  const live = useLive(engine, space, source)
  const harnesses = useHarnesses(engine, space)
  const [adding, setAdding] = useState(false)

  const openThread = (agent: AgentView, thread: string | null, place?: Place) =>
    open(
      paneOf(threadPane, { agent: agent.id, name: agent.name, thread }),
      place
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {live.state === "loading" ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : live.state === "refused" ? (
        <p className="p-4 text-sm text-muted-foreground">
          {live.refusal.message}
        </p>
      ) : live.view.agents.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BotIcon />
            </EmptyMedia>
            <EmptyTitle>No Agents yet</EmptyTitle>
            <EmptyDescription>
              An Agent works for you in this Space: it reads and writes the
              Space's files and asks you before it acts.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setAdding(true)}>
              <PlusIcon />
              New Agent
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <ScrollArea className="min-h-0 flex-1">
            <ul className="flex flex-col gap-1 p-2">
              {live.view.agents.map((agent) => (
                <AgentEntry
                  key={agent.id}
                  agent={agent}
                  harness={harnessName(harnesses, agent.harness)}
                  state={live.view}
                  onOpen={openThread}
                />
              ))}
            </ul>
          </ScrollArea>
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => setAdding(true)}
            >
              <PlusIcon />
              New Agent
            </Button>
          </div>
        </>
      )}
      <NewAgent
        engine={engine}
        space={space}
        harnesses={harnesses}
        open={adding}
        onOpenChange={setAdding}
        onCreated={(agent) => openThread(agent, null)}
      />
    </div>
  )
}

function AgentEntry({
  agent,
  harness,
  state,
  onOpen,
}: {
  agent: AgentView
  harness: string
  state: AgentsState
  onOpen: (agent: AgentView, thread: string | null, place?: Place) => void
}) {
  const threads = threadsOf(state, agent.id)
  return (
    <li className="group/agent flex flex-col">
      <div className="flex items-center gap-1">
        <Item
          size="sm"
          className="min-w-0 flex-1 cursor-pointer px-2 py-1.5 hover:bg-muted"
          render={<button type="button" />}
          onClick={(event) =>
            onOpen(agent, threads[0]?.id ?? null, placeOf(event))
          }
        >
          <ItemMedia variant="icon">
            <BotIcon />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="truncate">{agent.name}</ItemTitle>
            <ItemDescription className="truncate text-xs">
              {harness}
            </ItemDescription>
          </ItemContent>
        </Item>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`New Thread with ${agent.name}`}
          title="New Thread"
          className="opacity-0 group-hover/agent:opacity-100 focus-visible:opacity-100"
          onClick={(event) => onOpen(agent, null, placeOf(event))}
        >
          <SquarePenIcon />
        </Button>
      </div>
      {threads.length > 0 && (
        <ul className="ml-8 flex flex-col border-l pl-1">
          {threads.slice(0, RECENT).map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={(event) => onOpen(agent, thread.id, placeOf(event))}
              >
                <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                <span className="shrink-0 text-xs tabular-nums">
                  {ago(thread.updated_at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** The Harnesses this computer can run. */
function useHarnesses(engine: Engine, space: SpaceId): Read<HarnessView[]> {
  return useRead(
    useCallback(
      () => engine.call<HarnessView[]>("agents.harnesses", {}, { space }),
      [engine, space]
    )
  )
}

function listOf(harnesses: Read<HarnessView[]>): HarnessView[] {
  return harnesses.state === "ready" ? harnesses.value : []
}

function harnessName(harnesses: Read<HarnessView[]>, id: string): string {
  return listOf(harnesses).find((harness) => harness.id === id)?.name ?? id
}

function NewAgent({
  engine,
  space,
  harnesses,
  open,
  onOpenChange,
  onCreated,
}: {
  engine: Engine
  space: SpaceId
  harnesses: Read<HarnessView[]>
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (agent: AgentView) => void
}) {
  const [name, setName] = useState("")
  const [picked, setPicked] = useState<string | null>(null)
  const { busy, problem, act } = useAct()
  const choices = listOf(harnesses)
  const harness = picked ?? choices[0]?.id ?? null
  const ready = name.trim() !== "" && harness !== null && !busy

  const create = async () => {
    if (!ready) return
    const agent = await act(() =>
      engine.command<AgentView>(
        "agents.create",
        { name: name.trim(), harness },
        space
      )
    )
    if (!agent) return
    setName("")
    onOpenChange(false)
    onCreated(agent)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <DialogHeader>
            <DialogTitle>New Agent</DialogTitle>
            <DialogDescription>
              Give it a name, and pick its Harness: the AI program that does its
              work.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="agent-name">Name</FieldLabel>
              <Input
                id="agent-name"
                autoFocus
                placeholder="Writer"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Harness</FieldLabel>
              <Select
                value={harness}
                onValueChange={(value) => setPicked(value)}
                items={choices.map((h) => ({ value: h.id, label: h.name }))}
              >
                <SelectTrigger aria-label="Harness" className="w-full">
                  <SelectValue placeholder="No Harness on this computer" />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {harnesses.state === "refused" && (
              <FieldError>{harnesses.refusal.message}</FieldError>
            )}
            {problem && <FieldError>{problem}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={!ready}>
              {busy && <Spinner />}
              Create Agent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
