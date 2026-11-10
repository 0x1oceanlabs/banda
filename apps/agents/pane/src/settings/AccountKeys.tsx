/**
 * The keys of Add account (ADR 0078, decision 1): a gateway's, which Banda
 * keeps in this computer's keyring, and Codex's OpenAI key, which Codex
 * keeps. The window sends a key once and never reads it back.
 */
import { type ReactNode, useEffect, useState } from "react"
import type { Engine } from "@banda/contract"
import type { GatewayAdded, HarnessView, Kept } from "@banda/contract/harnesses"
import { Button } from "@banda/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@banda/ui/components/field"
import { Input } from "@banda/ui/components/input"
import { useAct } from "@banda/ui/hooks/use-act"
import { harnessTitle } from "../harnesses"
import { Problem } from "../thread/SignIn"
import { type Gateway, freeId, gatewaysOf } from "./accounts"

/** Where a gateway's key went, in words. */
export const KEPT_WORDS: Readonly<Record<Kept, string>> = {
  keyring: "Its key is in this computer’s keyring.",
  file: "Its key is in a file only you can read: this computer has no keyring.",
}

/** A gateway account: where its Harness sends its requests, and its key. */
export function GatewayForm({
  engine,
  base,
  taken,
  colour,
  onAdded,
  onBusy,
}: {
  engine: Engine
  base: HarnessView
  taken: readonly HarnessView[]
  colour: number
  onAdded: (added: GatewayAdded) => void
  onBusy: (busy: boolean) => void
}) {
  const gateways = gatewaysOf(base.harness)
  const [chosen, setChosen] = useState(gateways[0]!)
  const [name, setName] = useState(chosen.name)
  const [url, setUrl] = useState(chosen.urls[base.harness] ?? "")
  const [key, setKey] = useState("")
  const { busy, problem, act } = useAct()
  useEffect(() => onBusy(busy), [busy, onBusy])
  const id = freeId(chosen.id, taken)
  const harness = harnessTitle(taken, base.harness)
  const ready = !busy && [name, url, key].every((text) => text.trim())
  const choose = (gateway: Gateway) => {
    setChosen(gateway)
    setName(gateway.name)
    setUrl(gateway.urls[base.harness] ?? "")
  }
  const add = async () => {
    if (!ready) return
    const added = await act(() =>
      engine.command("harnesses.add_gateway", {
        harness: base.harness,
        id,
        name: name.trim(),
        colour,
        url: url.trim(),
        key,
      })
    )
    if (added) {
      setKey("")
      onAdded(added)
    }
  }
  return (
    <KeyForm problem={problem} onSubmit={() => void add()}>
      <Field>
        <FieldLabel>Gateway</FieldLabel>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Gateway">
          {gateways.map((gateway) => (
            <Button
              key={gateway.id}
              type="button"
              variant={gateway.id === chosen.id ? "default" : "outline"}
              aria-pressed={gateway.id === chosen.id}
              onClick={() => choose(gateway)}
            >
              {gateway.urls[base.harness] ? gateway.name : "Your own"}
            </Button>
          ))}
        </div>
      </Field>
      <Field>
        <FieldLabel htmlFor="gateway-name">Account name</FieldLabel>
        <Input
          id="gateway-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="gateway-url">Address</FieldLabel>
        <Input
          id="gateway-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={
            base.harness === "codex"
              ? "https://… (OpenAI’s Responses API)"
              : "https://… (Anthropic’s API)"
          }
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="gateway-key">Key</FieldLabel>
        <KeyInput
          id="gateway-key"
          value={key}
          onChange={setKey}
          placeholder="sk-…, op://… or pass:…"
        />
        <FieldDescription>
          It goes in this computer’s keyring (on a server with no screen, a file
          only you can read), never in a file {harness} reads. This window never
          shows it again: {harness} asks for it with{" "}
          <code>banda secret get {id}</code>.
        </FieldDescription>
      </Field>
      <Button type="submit" className="self-end" disabled={!ready}>
        {busy ? "Adding…" : "Add gateway"}
      </Button>
    </KeyForm>
  )
}

/** Codex's OpenAI key, which `codex login --with-api-key` keeps. */
export function ApiKeyForm({
  engine,
  harness,
  onKept,
  onBusy,
}: {
  engine: Engine
  harness: string
  onKept: () => void
  onBusy: (busy: boolean) => void
}) {
  const [key, setKey] = useState("")
  const { busy, problem, act } = useAct()
  useEffect(() => onBusy(busy), [busy, onBusy])
  const ready = !busy && key.trim() !== ""
  const send = async () => {
    if (!ready) return
    const done = await act(() =>
      engine.command("harnesses.api_key", { harness, key })
    )
    if (done !== undefined) {
      setKey("")
      onKept()
    }
  }
  return (
    <KeyForm problem={problem} onSubmit={() => void send()}>
      <Field>
        <FieldLabel htmlFor="api-key">OpenAI API key</FieldLabel>
        <KeyInput
          id="api-key"
          value={key}
          onChange={setKey}
          placeholder="sk-…"
        />
        <FieldDescription>
          Banda hands it to <code>codex login --with-api-key</code> and forgets
          it: Codex keeps it in this account’s own folder.
        </FieldDescription>
      </Field>
      <Button type="submit" className="self-end" disabled={!ready}>
        {busy ? "Signing in…" : "Sign in with this key"}
      </Button>
    </KeyForm>
  )
}

/** A form that sends a key, and says what went wrong. */
function KeyForm({
  problem,
  onSubmit,
  children,
}: {
  problem: string | undefined
  onSubmit: () => void
  children: ReactNode
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <FieldGroup>
        {children}
        {problem && <Problem>{problem}</Problem>}
      </FieldGroup>
    </form>
  )
}

/** A key's field: hidden as typed, never filled in or checked by the
 * browser. */
function KeyInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <Input
      id={id}
      type="password"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
    />
  )
}
