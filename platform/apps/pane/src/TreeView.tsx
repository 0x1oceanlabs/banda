/**
 * An App's screen, drawn from the Tree its view answered (ADR 0062,
 * decision 7): each node with Banda UI's own component, in the theme's
 * tokens. No code of the App runs here. A control sends one of the App's
 * own commands through `send`, and holds what the Person typed: nothing
 * a later Tree says overwrites a field.
 */
import type {
  Tree,
  TreeButton,
  TreeColumn,
  TreeField,
  TreeForm,
  TreeList,
  TreeNode,
  TreeTable,
} from "@banda/contract/apps"
import { Badge } from "@banda/ui/components/badge"
import { Button } from "@banda/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@banda/ui/components/card"
import { Checkbox } from "@banda/ui/components/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@banda/ui/components/empty"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@banda/ui/components/field"
import { Input } from "@banda/ui/components/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@banda/ui/components/item"
import { Markdown } from "@banda/ui/components/markdown"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@banda/ui/components/select"
import { Spinner } from "@banda/ui/components/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@banda/ui/components/table"
import { Textarea } from "@banda/ui/components/textarea"
import { useAct } from "@banda/ui/hooks/use-act"
import { cn } from "@banda/ui/lib/utils"
import { type FormEvent, memo, useId, useRef, useState } from "react"
import { emptyOf, type Filled, paramsOf } from "./form"

/**
 * Sends the App's command `command`, and comes back once it is done and
 * the screen shows it. It throws what went wrong.
 */
export type Send = (
  command: string,
  params: Record<string, unknown>
) => Promise<void>

/**
 * The Tree's nodes, under what it is for. Its title is its frame's to
 * say, the Pane's header here (guidelines, design.6). Drawn again only
 * for a Tree read again: a long table is not, each time its Pane takes
 * the focus.
 */
export const TreeView = memo(function TreeView({
  tree,
  send,
}: {
  tree: Tree
  send: Send
}) {
  return (
    <div data-slot="tree" className="flex flex-col gap-4 p-4">
      {tree.about && (
        <p className="text-meta text-muted-foreground">{tree.about}</p>
      )}
      <Nodes nodes={tree.children} send={send} />
    </div>
  )
})

/** The edge of what stands apart in a Tree with no Card around it: a
 * Card's own. */
const FRAME = "overflow-hidden rounded-card ring-1 ring-foreground/10"

function Nodes({ nodes, send }: { nodes: readonly TreeNode[]; send: Send }) {
  // A Tree has no keys: a node is the one in its place, so what a Form
  // holds stays with it while the Tree is read again.
  return nodes.map((node, place) => (
    <NodeView key={place} node={node} send={send} />
  ))
}

function NodeView({ node, send }: { node: TreeNode; send: Send }) {
  switch (node.node) {
    case "Card":
      return (
        <Card size="sm">
          {node.title && (
            <CardHeader>
              <CardTitle>{node.title}</CardTitle>
            </CardHeader>
          )}
          <CardContent className="flex flex-col gap-3">
            <Nodes nodes={node.children} send={send} />
          </CardContent>
        </Card>
      )
    case "Table":
      return <TableNode table={node} />
    case "List":
      return <ListNode list={node} />
    case "Form":
      return <FormNode form={node} send={send} />
    case "Button":
      return <ButtonNode button={node} send={send} />
    case "Badge":
      return <Badge variant="outline">{node.text}</Badge>
    case "Empty":
      return <Nothing title={node.title} about={node.about} />
    case "Markdown":
      return <Markdown>{node.text}</Markdown>
    default:
      // A machine on a newer Banda may name a node this window does not
      // have yet: said in its place, and the rest is drawn.
      return (
        <p
          data-slot="tree-unknown"
          className="rounded-card border border-dashed p-3 text-meta text-muted-foreground"
        >
          Update Banda to see this part.
        </p>
      )
  }
}

function Nothing({ title, about }: { title: string; about?: string | null }) {
  return (
    <Empty className={FRAME}>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {about && <EmptyDescription>{about}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  )
}

type Cell = TreeTable["rows"][number][string] | undefined

/** Whether a column holds numbers only, which read from the right. */
function numeric(table: TreeTable, column: TreeColumn): boolean {
  const cells = table.rows.map((row) => row[column.key] ?? null)
  return (
    cells.some((cell) => typeof cell === "number") &&
    cells.every((cell) => cell === null || typeof cell === "number")
  )
}

function CellView({ cell, column }: { cell: Cell; column: TreeColumn }) {
  if (cell === null || cell === undefined || cell === "")
    return <span className="text-muted-foreground">—</span>
  const words = typeof cell === "boolean" ? (cell ? "Yes" : "No") : `${cell}`
  return column.as === "badge" ? (
    <Badge variant="outline">{words}</Badge>
  ) : (
    words
  )
}

function TableNode({ table }: { table: TreeTable }) {
  if (table.rows.length === 0 && table.empty)
    return <Nothing title={table.empty} />
  const right = table.columns.map(
    (column) => column.as === "badge" || numeric(table, column)
  )
  return (
    <div data-slot="tree-table" className={FRAME}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {table.columns.map((column, at) => (
              <TableHead
                key={column.key}
                className={cn(right[at] && "text-right")}
              >
                {column.title}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((row, place) => (
            <TableRow key={place}>
              {table.columns.map((column, at) => (
                <TableCell
                  key={column.key}
                  className={cn(
                    at > 0 && "text-muted-foreground",
                    right[at] && "text-right tabular-nums"
                  )}
                >
                  <CellView cell={row[column.key]} column={column} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ListNode({ list }: { list: TreeList }) {
  if (list.items.length === 0 && list.empty)
    return <Nothing title={list.empty} />
  return (
    <ItemGroup data-slot="tree-list" className={FRAME}>
      {list.items.map((item, place) => (
        <Item key={place} size="sm">
          <ItemContent>
            <ItemTitle>{item.title}</ItemTitle>
            {item.about && <ItemDescription>{item.about}</ItemDescription>}
          </ItemContent>
          {item.badge && (
            <ItemActions>
              <Badge variant="outline">{item.badge}</Badge>
            </ItemActions>
          )}
        </Item>
      ))}
    </ItemGroup>
  )
}

function FormNode({ form, send }: { form: TreeForm; send: Send }) {
  const id = useId()
  const [filled, setFilled] = useState<Filled>(() => emptyOf(form.fields))
  /** What stops it from being sent, by field: said under the field. */
  const [amiss, setAmiss] = useState<Record<string, string>>({})
  const { busy, problem, act } = useAct()

  const set = (name: string, value: string | boolean) => {
    setFilled((filled) => ({ ...filled, [name]: value }))
    setAmiss((amiss) =>
      Object.fromEntries(
        Object.entries(amiss).filter(([field]) => field !== name)
      )
    )
  }

  const first = useRef<HTMLDivElement>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const read = paramsOf(form.fields, filled)
    if ("amiss" in read) {
      setAmiss(read.amiss)
      return
    }
    void act(async () => {
      await send(form.command, read.params)
      setFilled(emptyOf(form.fields))
      // Ready for the next one, from its first field.
      first.current?.querySelector<HTMLElement>("input, textarea")?.focus()
    }, form.submit)
  }

  return (
    <form
      data-slot="tree-form"
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-3"
    >
      {form.title && <h2 className="text-ui font-semibold">{form.title}</h2>}
      {/* A field keeps a width that reads, however wide its Pane is. */}
      <FieldGroup ref={first} className="max-w-md gap-3">
        {form.fields.map((field) => (
          <FieldView
            key={field.name}
            id={`${id}-${field.name}`}
            field={field}
            value={filled[field.name] ?? ""}
            amiss={amiss[field.name]}
            set={(value) => set(field.name, value)}
          />
        ))}
      </FieldGroup>
      {problem && <FieldError>{problem}</FieldError>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" aria-busy={busy}>
          {busy && <Spinner />}
          {form.submit}
        </Button>
      </div>
    </form>
  )
}

function FieldView({
  id,
  field,
  value,
  amiss,
  set,
}: {
  id: string
  field: TreeField
  value: string | boolean
  amiss: string | undefined
  set: (value: string | boolean) => void
}) {
  const label = (
    <FieldLabel htmlFor={id}>
      {field.label}
      {field.required && <span aria-hidden>*</span>}
    </FieldLabel>
  )
  const said = amiss && <FieldError>{amiss}</FieldError>
  const shared = {
    id,
    "aria-invalid": amiss ? true : undefined,
    "aria-required": field.required || undefined,
  }
  if (field.kind === "checkbox")
    return (
      <Field orientation="horizontal" data-invalid={amiss ? true : undefined}>
        <Checkbox
          {...shared}
          checked={value === true}
          onCheckedChange={(on) => set(on === true)}
        />
        {label}
      </Field>
    )
  const text = typeof value === "string" ? value : ""
  const placeholder = field.placeholder ?? undefined
  return (
    <Field data-invalid={amiss ? true : undefined}>
      {label}
      {field.kind === "select" ? (
        <Select
          value={text === "" ? null : text}
          onValueChange={(value) => set(typeof value === "string" ? value : "")}
        >
          <SelectTrigger {...shared}>
            <SelectValue placeholder={placeholder}>
              {(value: string | null) =>
                field.options.find((option) => option.value === value)?.label
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.kind === "textarea" ? (
        <Textarea
          {...shared}
          value={text}
          placeholder={placeholder}
          onChange={(event) => set(event.target.value)}
        />
      ) : (
        <Input
          {...shared}
          value={text}
          placeholder={placeholder}
          inputMode={field.kind === "number" ? "decimal" : undefined}
          autoComplete="off"
          onChange={(event) => set(event.target.value)}
        />
      )}
      {said}
    </Field>
  )
}

function ButtonNode({ button, send }: { button: TreeButton; send: Send }) {
  const { busy, problem, act } = useAct()
  return (
    <div data-slot="tree-button" className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        aria-busy={busy}
        onClick={() =>
          busy ||
          void act(() => send(button.command, button.params), button.label)
        }
      >
        {busy && <Spinner />}
        {button.label}
      </Button>
      {problem && <FieldError>{problem}</FieldError>}
    </div>
  )
}
