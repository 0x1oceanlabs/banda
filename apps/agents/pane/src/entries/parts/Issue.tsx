/**
 * An issue the Agent drafted about a Problem of Banda's (ADR 0039,
 * decision 3): a card that asks the Person to send it to Banda on
 * GitHub, with Send, Edit and Cancel. Only the Person sends it: the
 * problems module sends it (`problems.send_issue`), with `gh` or by the
 * browser, and the agents module keeps the answer; both need `Decide`.
 */
import { useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { ItemId } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { Input } from "@banda/ui/components/input"
import { Textarea } from "@banda/ui/components/textarea"
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import { useAct } from "@banda/ui/hooks/use-act"
import { copyText } from "@banda/ui/lib/clipboard"
import { BugIcon, CheckIcon, XIcon } from "lucide-react"
import { Card, CardBody } from "./Card"
import type { IssueBody } from "../../thread/state"

type Props = {
  engine: Engine
  project: ProjectId
  item: ItemId
  issue: IssueBody
  /** Opens a web address on this device, through the router. */
  openLink: (url: string) => void
}

export function Issue(props: Props) {
  return props.issue.state === "drafted" ? (
    <Draft {...props} />
  ) : (
    <Answered issue={props.issue} />
  )
}

/**
 * An issue `gh` did not file: GitHub's page, through the router to this
 * device's browser, whichever machine's Thread drafted it (ADR 0106, law
 * 2). A comment is not filled in by its address: it waits to be pasted,
 * on this device's clipboard.
 */
export async function openToPaste(
  url: string,
  body: string,
  comment_on: number | undefined,
  openLink: Props["openLink"]
) {
  // Before the browser takes the focus the copy needs.
  if (comment_on !== undefined) await copyText(body)
  openLink(url)
}

function Draft({ engine, project, item, issue, openLink }: Props) {
  const { busy, problem, act } = useAct()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(issue.title)
  const [body, setBody] = useState(issue.body)
  const { fingerprint, comment_on } = issue

  const send = () =>
    act(async () => {
      const sent = await engine.command("problems.send_issue", {
        fingerprint,
        title,
        body,
        ...(comment_on !== undefined && { comment_on }),
      })
      if (!sent.filed) await openToPaste(sent.url, body, comment_on, openLink)
      const state = sent.filed ? "sent" : "opened"
      const answer = { item, state, title, body, url: sent.url } as const
      await engine.command("agents.answer_issue", answer, project)
    })
  const cancel = () =>
    act(() =>
      engine.command(
        "agents.answer_issue",
        { item, state: "cancelled" },
        project
      )
    )
  return (
    <Card
      icon={<BugIcon />}
      title={
        comment_on === undefined
          ? "Send this report to Banda on GitHub?"
          : `Add this to issue #${comment_on} on GitHub?`
      }
      action={
        <span className="font-mono text-xs text-muted-foreground">
          {fingerprint}
        </span>
      }
    >
      <CardBody>
        {editing ? (
          <div className="flex flex-col gap-2">
            {comment_on === undefined && (
              <Input
                aria-label="Title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
            <Textarea
              aria-label="Body"
              className="max-h-80 min-h-40 font-mono text-xs"
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {comment_on === undefined && (
              <span className="font-medium">{title}</span>
            )}
            <pre className="max-h-40 overflow-auto rounded-control bg-raised px-3 py-2 font-mono text-code whitespace-pre-wrap text-muted-foreground">
              {body}
            </pre>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          What goes is exactly this text: no paths, no Pane's args, no Thread's
          words. With gh signed in, Banda files it; else GitHub opens with it
          filled in.
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => void send()}>
            Send
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setEditing(!editing)}
          >
            {editing ? "Done" : "Edit"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void cancel()}
          >
            Cancel
          </Button>
        </div>
        {problem && (
          <p role="alert" className="text-xs text-destructive">
            {problem}
          </p>
        )}
      </CardBody>
    </Card>
  )
}

/** What became of it: where it went, or that it did not. */
function said(issue: IssueBody): string {
  switch (issue.state) {
    case "sent": {
      if (issue.comment_on !== undefined)
        return `Added to issue #${issue.comment_on}`
      const number = issue.url && /\/issues\/(\d+)/.exec(issue.url)?.[1]
      return number ? `Sent as issue #${number}` : "Sent"
    }
    case "opened":
      return "Opened on GitHub, to send there"
    default:
      return "Not sent"
  }
}

/** The issue once the Person answered it, as one line. */
function Answered({ issue }: { issue: IssueBody }) {
  return (
    <Trace>
      <TraceLine>
        <TraceIcon>{issue.url ? <CheckIcon /> : <XIcon />}</TraceIcon>
        <TraceTitle>
          {issue.url ? (
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              {said(issue)}
            </a>
          ) : (
            said(issue)
          )}
          <span className="text-muted-foreground"> · {issue.title}</span>
        </TraceTitle>
      </TraceLine>
    </Trace>
  )
}
