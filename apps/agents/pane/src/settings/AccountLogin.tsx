/** The engine owns sign-in, including when Settings has no Project (ADR 0103). */
import { useCallback, useEffect, useState } from "react"
import type { Engine } from "@banda/contract"
import type { LoginStatus } from "@banda/contract/harnesses"
import { Button } from "@banda/ui/components/button"
import { CopyButton } from "@banda/ui/components/copy-button"
import { loginOutput } from "./login-output"
import { Input } from "@banda/ui/components/input"
import { Spinner } from "@banda/ui/components/spinner"
import { useRead } from "@banda/ui/hooks/use-read"
import { problem } from "@banda/ui/lib/words"
import { Problem } from "../thread/SignIn"

export function AccountLogin({
  engine,
  harness,
  onRunning,
}: {
  engine: Engine
  harness: string
  onRunning?: (running: boolean) => void
}) {
  const [round, setRound] = useState(0)
  const [job, setJob] = useState<LoginStatus>()
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState("")
  const [refused, setRefused] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const read = useRead(
    useCallback(
      () => engine.call("harnesses.account_status", { harness }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Check again starts a fresh read
      [engine, harness, round]
    )
  )
  const output = loginOutput(job?.output ?? "")
  const login = job?.login
  useEffect(
    () => onRunning?.(busy || login !== undefined),
    [busy, login, onRunning]
  )
  // The engine runs the sign-in to its end and finishes it; the window
  // only watches it (ADR 0108, decision 5).
  useEffect(() => {
    if (!login) return
    return engine.stream(
      undefined,
      "harnesses.login_watch",
      { login },
      (next) => {
        if (!next.done) return setJob(next)
        setJob(undefined)
        setNotice(
          next.succeeded
            ? "Sign-in finished. Checking the account…"
            : "Sign-in ended without completing. You can try again."
        )
        setRound((n) => n + 1)
      },
      (refusal, error) => {
        if (!refusal && !error) return
        // The engine runs on with it: Check again says how it ended.
        setRefused(refusal?.message ?? problem(error))
        setJob(undefined)
        setRound((n) => n + 1)
      }
    )
  }, [engine, login])
  const act = async (run: () => Promise<void>) => {
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
  const start = (way: string) =>
    void act(async () => {
      setNotice(undefined)
      setJob(await engine.call("harnesses.login_account", { harness, way }))
    })
  const who = read.state === "ready" ? read.value.signed_in_as : undefined
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {read.state === "loading" && (
        <span className="flex items-center gap-2">
          <Spinner /> Checking account…
        </span>
      )}
      {read.state === "refused" && <Problem>{read.refusal.message}</Problem>}
      {who?.signed_in && (
        <p role="status">
          Signed in · {[who.label, who.email].filter(Boolean).join(" · ")}
        </p>
      )}
      {notice && !who?.signed_in && (
        <p role="status" className="text-ui text-muted-foreground">
          {notice}
        </p>
      )}
      {job ? (
        <>
          <p className="text-ui text-muted-foreground">
            Complete the provider’s sign-in below. You can open its verification
            link on another computer.
          </p>
          <pre
            aria-label="Sign-in output"
            className="max-h-48 overflow-auto rounded-control border p-3 text-meta [overflow-wrap:anywhere] whitespace-pre-wrap select-text"
          >
            {output.text || "Waiting for the sign-in instructions…"}
          </pre>
          {output.links.map((link) => (
            <div key={link} className="flex items-center gap-2 text-ui">
              <span>Sign-in link · {new URL(link).hostname}</span>
              <CopyButton text={link} label="Copy sign-in link" />
            </div>
          ))}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!reply || busy) return
              void act(async () => {
                await engine.call("harnesses.login_input", {
                  login: job.login,
                  text: `${reply}\n`,
                })
                setReply("")
              })
            }}
          >
            <Input
              aria-label="Reply to sign-in"
              placeholder="Confirmation code or reply"
              value={reply}
              autoComplete="off"
              onChange={(event) => setReply(event.target.value)}
            />
            <Button type="submit" disabled={busy || !reply}>
              Send
            </Button>
          </form>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await engine.call("harnesses.login_cancel", {
                  login: job.login,
                })
              })
            }
          >
            Cancel sign-in
          </Button>
        </>
      ) : (
        <>
          {read.state === "ready" && !who?.signed_in && (
            <div className="flex flex-wrap gap-2">
              {read.value.ways.map((way) => (
                <Button
                  key={way.id}
                  disabled={busy}
                  onClick={() => start(way.id)}
                >
                  {way.name}
                </Button>
              ))}
            </div>
          )}
          <Button
            variant="ghost"
            disabled={busy || read.state === "loading"}
            onClick={() => {
              setNotice(undefined)
              setRound((n) => n + 1)
            }}
          >
            Check sign-in again
          </Button>
        </>
      )}
      {refused && <Problem>{refused}</Problem>}
    </div>
  )
}
