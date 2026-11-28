/**
 * A Harness's setup as one sheet (ADR 0140, decisions 6 to 8): its steps
 * in a list, each with its mark, and one button that runs what is left.
 * The engine runs it; closed, it goes on, and the Harness's row says where
 * it is. What its programs print stays under Details.
 */
import { useState } from "react"
import type { Engine } from "@banda/contract"
import type { Setup, SetupStep } from "@banda/contract/harnesses"
import { Button } from "@banda/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@banda/ui/components/collapsible"
import { CopyButton } from "@banda/ui/components/copy-button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { Emblem, type EmblemOf } from "@banda/ui/components/emblem"
import { Input } from "@banda/ui/components/input"
import { Spinner } from "@banda/ui/components/spinner"
import { cn } from "@banda/ui/lib/utils"
import { problem } from "@banda/ui/lib/words"
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleIcon,
  CircleXIcon,
} from "lucide-react"
import { loginOutput } from "../settings/login-output"
import { Problem } from "../thread/SignIn"
import { headOf, rowOf, stepWord, stoppedAt } from "./setup"

export function SetupSheet({
  engine,
  account,
  setup,
  open,
  onOpenChange,
  done = "Done",
}: {
  engine: Engine
  /** The entry it sets up, for its emblem. */
  account: EmblemOf
  setup: Setup
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What the button says once it is ready. */
  done?: string
}) {
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string>()
  const [details, setDetails] = useState<boolean>()
  const head = headOf(setup)
  const stopped = stoppedAt(setup)
  const output = loginOutput(setup.output)
  const harness = setup.harness
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true)
    setRefused(undefined)
    try {
      await run()
    } catch (error) {
      setRefused(problem(error))
    } finally {
      setBusy(false)
    }
  }
  const gitLeft = setup.steps[0]?.state !== "done" && !setup.running
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader className="flex-row gap-3 pr-8">
          <Emblem of={account} className="mt-0.5 size-6 shrink-0" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle>{head.title}</DialogTitle>
            <DialogDescription>{head.says}</DialogDescription>
          </div>
        </DialogHeader>
        <ol className="flex flex-col divide-y">
          {setup.steps.map((step) => (
            <Step key={step.id} step={step} />
          ))}
        </ol>
        {setup.login && (
          <SignInReply
            links={output.links}
            busy={busy}
            onReply={(text) =>
              act(() =>
                engine.call("harnesses.login_input", {
                  login: setup.login!,
                  text: `${text}\n`,
                })
              )
            }
          />
        )}
        {output.text && (
          <Collapsible
            open={details ?? stopped !== undefined}
            onOpenChange={setDetails}
          >
            <CollapsibleTrigger className="group flex items-center gap-1 rounded-control text-meta text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRightIcon className="size-3.5 group-data-panel-open:rotate-90" />
              Details
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 flex flex-col items-end gap-1">
                <pre
                  aria-label="What it printed"
                  className="max-h-40 w-full overflow-auto rounded-control border p-2 text-meta [overflow-wrap:anywhere] whitespace-pre-wrap select-text"
                >
                  {output.text}
                </pre>
                <CopyButton text={output.text} label="Copy details" />
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
        {refused && <Problem>{refused}</Problem>}
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-meta text-muted-foreground">
            {setup.login
              ? "Banda never sees your password."
              : gitLeft && !setup.ready
                ? "Your system asks once to allow Git’s installer."
                : ""}
          </p>
          {setup.running ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  engine.call("harnesses.setup_cancel", { harness })
                )
              }
            >
              Stop
            </Button>
          ) : setup.ready ? (
            <Button onClick={() => onOpenChange(false)}>{done}</Button>
          ) : (
            <Button
              disabled={busy}
              onClick={() =>
                void act(() =>
                  engine.call("harnesses.setup_start", { harness })
                )
              }
            >
              {rowOf(setup).button}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const MARK = {
  waiting: <CircleIcon className="text-muted-foreground" />,
  running: <Spinner className="text-muted-foreground" />,
  asks: <CircleAlertIcon className="text-attention" />,
  done: <CircleCheckIcon className="text-added" />,
  failed: <CircleXIcon className="text-destructive" />,
} as const

function Step({ step }: { step: SetupStep }) {
  const word = stepWord(step)
  return (
    <li className="flex gap-3 py-2.5 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0">
      {MARK[step.state]}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              "text-ui font-medium",
              step.state === "waiting" && "text-muted-foreground"
            )}
          >
            {step.name}
          </span>
          {word && (
            <span
              className={cn(
                "shrink-0 text-meta text-muted-foreground",
                step.state === "asks" && "text-attention",
                step.state === "failed" && "text-destructive"
              )}
            >
              {word}
            </span>
          )}
        </div>
        <span className="text-meta text-muted-foreground">{step.says}</span>
        {step.note && (
          <span className="text-meta text-destructive">{step.note}</span>
        )}
      </div>
    </li>
  )
}

/** What a sign-in may ask of the Person besides their browser: its link,
 * to open on another computer, and the code its page shows. */
function SignInReply({
  links,
  busy,
  onReply,
}: {
  links: readonly string[]
  busy: boolean
  onReply: (text: string) => Promise<void>
}) {
  const [reply, setReply] = useState("")
  return (
    <div className="flex flex-col gap-2">
      {links.map((link) => (
        <div key={link} className="flex items-center gap-2 text-meta">
          <span className="text-muted-foreground">
            Sign-in link · {new URL(link).hostname}
          </span>
          <CopyButton text={link} label="Copy sign-in link" />
        </div>
      ))}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!reply || busy) return
          void onReply(reply).then(() => setReply(""))
        }}
      >
        <Input
          aria-label="Reply to sign-in"
          placeholder="A code, if its page shows one"
          value={reply}
          autoComplete="off"
          onChange={(event) => setReply(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={busy || !reply}>
          Send
        </Button>
      </form>
    </div>
  )
}
