import { Fragment, useImperativeHandle, useRef, useState } from "react"
import type { Choice, ToolKind } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { Satellite } from "@banda/ui/components/satellite"
import { FIELDS } from "@banda/ui/lib/keys"
import { short } from "@banda/ui/lib/words"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MinusIcon,
  ShieldQuestionIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"
import { Docked } from "../entries/parts/Card"
import { ProposedPlan } from "../entries/parts/ProposedPlan"
import {
  answersOf,
  choiceAt,
  type Folded,
  foldedOf,
  plain,
  type Press,
  wordsOf,
} from "./asking"
import type { Values } from "./form"
import { KeyHint, QuestionForm } from "./QuestionForm"
import type { Asked, QuestionBody } from "../thread/state"

/** How a Question is answered: with one of its choices, and what its form
 * holds. */
export type Answer = (choice: string, values?: Values) => void

/** What a key free in the Pane does to the Question in the drawer: Esc
 * says no, Enter gives the main answer; whether it did. */
export type AnswerKeys = (answer: "decline" | "main") => boolean

/**
 * A Question in the Thread (ADR 0058, decision 6). It is answered in the
 * drawer on the composer, so here, while it waits, it is one line in the
 * colour of what waits for the Person; answered, one line of what was
 * said, as an answered Issue. A plan Claude Code asks to carry out is the
 * plan's card, with that line in it.
 */
export function Question({ question }: { question: QuestionBody }) {
  const line =
    question.state === "open" ? (
      <WaitingLine title={plain(question.title)} />
    ) : (
      <FoldedLine folded={foldedOf(question)} />
    )
  if (question.plan !== undefined)
    return <ProposedPlan text={question.plan}>{line}</ProposedPlan>
  return line
}

function WaitingLine({ title }: { title: string }) {
  return (
    <Trace>
      <TraceLine className="text-attention">
        <TraceIcon>
          <ShieldQuestionIcon />
        </TraceIcon>
        <TraceTitle className="whitespace-normal">
          {`Waiting for you: ${title}`}
        </TraceTitle>
      </TraceLine>
    </Trace>
  )
}

const FOLDED_ICONS: Record<Folded["kind"], LucideIcon> = {
  allowed: CheckIcon,
  chose: CheckIcon,
  answered: CheckIcon,
  declined: XIcon,
  skipped: XIcon,
  closed: MinusIcon,
}

/** An answered Question, as one line; a form's answers open from it. */
function FoldedLine({ folded }: { folded: Folded }) {
  const Icon = FOLDED_ICONS[folded.kind]
  const line = (
    <TraceLine>
      <TraceIcon>
        <Icon />
      </TraceIcon>
      <TraceTitle title={folded.text}>{folded.text}</TraceTitle>
    </TraceLine>
  )
  if (!folded.values) return <Trace>{line}</Trace>
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {folded.values.map(({ id, title, value }) => (
              <Fragment key={id}>
                <dt>{title}</dt>
                <dd className="min-w-0 wrap-break-word text-foreground">
                  {value}
                </dd>
              </Fragment>
            ))}
          </dl>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

/**
 * The Question that waits for the Person, docked on the composer where
 * they already look (ADR 0058, decision 6): what it asks in words, the
 * command it is about in mono, and its answers with their keys. Esc says
 * no and Enter gives the main answer from anywhere in the Pane, by way of
 * `keys`; 1–9 pick a choice from within the drawer. A form asks one field
 * at a time. It folds to one line and opens again. A sub-agent's names who
 * asks: "Reviewer asks · 2m" (ADR 0103, decision 28).
 */
export function QuestionDrawer({
  item,
  about,
  asker,
  name,
  answering,
  onAnswer,
  keys,
}: {
  item: Asked
  /** The kind of tool call it asks about, if any. */
  about?: ToolKind
  /** What names the sub-agent that asks; none for the Agent's own. */
  asker?: string
  /** The Agent's Harness, as the words say who asks. */
  name: string
  answering: boolean
  onAnswer: Answer
  keys?: React.Ref<AnswerKeys>
}) {
  const { title, choices, form } = item.body
  const [folded, setFolded] = useState(false)
  const { words, detail } = wordsOf(item.body, about, name)
  const answers = answersOf(choices)
  // A form's Enter goes to its field shown: Next, or Submit on the last.
  const formEnter = useRef<() => boolean>(null)
  useImperativeHandle(keys, () => (answer) => {
    if (folded) return false
    if (answer === "main" && form) return formEnter.current?.() ?? false
    const choice = answer === "decline" ? answers.decline : answers.main
    if (!choice) return false
    if (!answering) onAnswer(choice.id)
    return true
  })
  const pick = (event: React.KeyboardEvent) => {
    const choice = !form && !folded && choiceAt(choices, event.key)
    if (!choice || typing(event.target) || modded(event)) return
    event.preventDefault()
    event.stopPropagation()
    if (!answering) onAnswer(choice.id)
  }
  return (
    <Docked
      label={plain(title)}
      className="flex flex-col [border-color:color-mix(in_srgb,var(--attention)_40%,var(--border))] px-4 pt-2.5 pb-3"
      onKeyDown={pick}
    >
      <div className="flex h-6 items-center gap-2">
        {asker ? (
          <span className="flex min-w-0 items-center gap-1.5 text-meta font-semibold text-attention">
            <span aria-hidden className="flex shrink-0">
              <Satellite state="asks" size={10} />
            </span>
            <span className="truncate">{`${asker} asks · ${short(item.at)}`}</span>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-attention">
            <span aria-hidden className="size-1.5 rounded-full bg-attention" />
            Needs you
          </span>
        )}
        {folded && <span className="min-w-0 truncate font-[550]">{words}</span>}
        <Button
          size="icon-xs"
          variant="ghost"
          // Quiet open or folded: not the pressed look of a menu's button.
          className="-mr-1.5 ml-auto text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground"
          aria-expanded={!folded}
          aria-label={folded ? "Show the question" : "Fold the question"}
          onClick={() => setFolded(!folded)}
        >
          {folded ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </Button>
      </div>
      {!folded && (
        <>
          {!(asker && detail === words) && (
            <p className="mt-0.5 text-ui font-[550] wrap-break-word">
              {words}
            </p>
          )}
          {detail && (
            <pre className="mt-2 max-h-32 overflow-auto rounded-control bg-raised px-3 py-2 font-mono text-code break-all whitespace-pre-wrap">
              {detail}
            </pre>
          )}
          <div className="mt-3">
            {form ? (
              <QuestionForm
                form={form}
                choices={choices}
                answering={answering}
                onAnswer={onAnswer}
                enter={formEnter}
              />
            ) : (
              <Answers
                choices={choices}
                answering={answering}
                onAnswer={onAnswer}
              />
            )}
          </div>
        </>
      )}
    </Docked>
  )
}

/** A Question's answers as Codex and Claude Code lay a permission out:
 * the one that says no on the left with Esc, the main one last with ⏎, the
 * ones the Harness keeps for next time under More. Each also takes its
 * number, in the Harness's order. */
function Answers({
  choices,
  answering,
  onAnswer,
}: {
  choices: Choice[]
  answering: boolean
  onAnswer: Answer
}) {
  const { decline, main, others, kept } = answersOf(choices)
  const number = (choice: Choice) => String(choices.indexOf(choice) + 1)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {decline && (
        <Button
          size="sm"
          variant="outline"
          className="pr-1.5"
          aria-keyshortcuts="Escape"
          disabled={answering}
          onClick={() => onAnswer(decline.id)}
        >
          {plain(decline.name)}
          <KeyHint>Esc</KeyHint>
        </Button>
      )}
      <span className="flex-1" />
      {others.map((choice) => (
        <Button
          key={choice.id}
          size="sm"
          variant="outline"
          className="pr-1.5"
          aria-keyshortcuts={number(choice)}
          disabled={answering}
          onClick={() => onAnswer(choice.id)}
        >
          {plain(choice.name)}
          <KeyHint>{number(choice)}</KeyHint>
        </Button>
      ))}
      {kept.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={answering}
            render={
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
              >
                More
                <ChevronDownIcon data-icon="inline-end" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {kept.map((choice) => (
              <DropdownMenuItem
                key={choice.id}
                onClick={() => onAnswer(choice.id)}
              >
                {plain(choice.name)}
                <DropdownMenuShortcut>{number(choice)}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {main && (
        <Button
          size="sm"
          className="pr-1.5"
          aria-keyshortcuts="Enter"
          disabled={answering}
          onClick={() => onAnswer(main.id)}
        >
          {plain(main.name)}
          <KeyHint>⏎</KeyHint>
        </Button>
      )}
    </div>
  )
}

/** Whether `target` is a field that takes text, where a number is typed. */
function typing(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement &&
        !["radio", "checkbox"].includes(target.type)))
  )
}

function modded(event: React.KeyboardEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
}

/** What takes Enter for itself, beside a field: a control it would
 * press. */
const CONTROLS =
  "button,a[href],summary,[role=button],[role=checkbox],[role=menuitem],[role=option],[role=radio],[role=switch],[role=tab],[role=slider],[data-takes-keys]"

/**
 * A key pressed in the Thread Pane `pane`, as {@link keyAnswer} reads it;
 * none for one pressed outside its page, in a menu or a dialog it opened.
 * `composer` holds the composer, whose text field takes Enter to send;
 * `written` says whether it held a message as the key went down.
 */
export function pressOf(
  event: React.KeyboardEvent,
  pane: Element | null,
  composer: Element | null,
  written: boolean
): Press | undefined {
  const target = event.target
  if (!(target instanceof Element) || !pane?.contains(target)) return undefined
  const inComposer =
    target instanceof HTMLElement &&
    target.isContentEditable &&
    composer?.contains(target) === true
  return {
    key: event.key,
    mods: modded(event),
    composing: event.nativeEvent.isComposing,
    taken: event.nativeEvent.defaultPrevented,
    on: inComposer
      ? "composer"
      : target.closest(FIELDS)
        ? "field"
        : target.closest(CONTROLS)
          ? "control"
          : "other",
    written: inComposer && written,
  }
}
