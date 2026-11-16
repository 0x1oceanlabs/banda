/**
 * An App's screen, drawn from the Tree its view answered (ADR 0062,
 * decision 7): each node with Banda UI's own component, in the theme's
 * tokens. No code of the App runs here. A control sends one of the App's
 * own commands through `send`, and holds what the Person typed: nothing
 * a later Tree says overwrites a field.
 */
import type {
  Tree,
  TreeAccordion,
  TreeDialog,
  TreeLink,
  TreeList,
  TreeNode,
  TreeStat,
  TreeTabs,
} from "@banda/contract/apps"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@banda/ui/components/accordion"
import { Alert, AlertDescription, AlertTitle } from "@banda/ui/components/alert"
import { Badge } from "@banda/ui/components/badge"
import { Button } from "@banda/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@banda/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@banda/ui/components/dialog"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@banda/ui/components/item"
import { Markdown } from "@banda/ui/components/markdown"
import { clamp, Progress } from "@banda/ui/components/progress"
import { Separator } from "@banda/ui/components/separator"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@banda/ui/components/tabs"
import { cn } from "@banda/ui/lib/utils"
import { ChevronRightIcon } from "lucide-react"
import { memo, useContext, useState } from "react"
import { ActButton } from "./Act"
import { ChartNode } from "./ChartNode"
import { Closing, FormNode, type Send } from "./Fields"
import { TableNode } from "./TableNode"
import { FRAME, Nothing } from "./frame"
import { Opening } from "./nav"
import { opensWith } from "./rows"
import { ALERT, toneBadge, toneText } from "./tone"

export type { Send }

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
    <div data-slot="tree" className="@container flex flex-col gap-4 p-4">
      {tree.about && (
        <p className="text-meta text-muted-foreground">{tree.about}</p>
      )}
      <Nodes nodes={tree.children} send={send} />
    </div>
  )
})

/** A Grid's columns by how many the App asked for: fewer where its Pane
 * is narrow, and as many as fit when it asked for none. */
const ACROSS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 @md:grid-cols-2",
  3: "grid-cols-1 @md:grid-cols-3",
  4: "grid-cols-2 @2xl:grid-cols-4",
  5: "grid-cols-2 @md:grid-cols-3 @3xl:grid-cols-5",
  6: "grid-cols-2 @md:grid-cols-3 @3xl:grid-cols-6",
}
const AS_FIT = "grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]"

function Nodes({ nodes, send }: { nodes: readonly TreeNode[]; send: Send }) {
  // A Tree has no keys: a node is the one in its place, so what a Form
  // holds stays with it while the Tree is read again.
  return nodes.map((node, place) => (
    <NodeView key={place} node={node} send={send} />
  ))
}

// Drawn again only for a node read again: a tab chosen or a dialog
// opened above it redraws none of what is under.
const NodeView = memo(function NodeView({
  node,
  send,
}: {
  node: TreeNode
  send: Send
}) {
  switch (node.node) {
    case "Card":
      return (
        <Card size="sm">
          {(node.title || node.about) && (
            <CardHeader>
              {node.title && <CardTitle>{node.title}</CardTitle>}
              {node.about && <CardDescription>{node.about}</CardDescription>}
            </CardHeader>
          )}
          <CardContent className="flex flex-col gap-3">
            <Nodes nodes={node.children} send={send} />
          </CardContent>
        </Card>
      )
    case "Grid":
      return (
        <div
          data-slot="tree-grid"
          className={cn(
            "grid items-start gap-3",
            (node.columns && ACROSS[node.columns]) || AS_FIT
          )}
        >
          <Nodes nodes={node.children} send={send} />
        </div>
      )
    case "Tabs":
      return <TabsNode tabs={node} send={send} />
    case "Accordion":
      return <AccordionNode accordion={node} send={send} />
    case "Dialog":
      return <DialogNode dialog={node} send={send} />
    case "Table":
      return <TableNode table={node} send={send} />
    case "List":
      return <ListNode list={node} send={send} />
    case "Chart":
      return <ChartNode chart={node} />
    case "Stat":
      return <StatNode stat={node} />
    case "Progress":
      return (
        <div data-slot="tree-progress" className="flex flex-col gap-1.5">
          {node.label && (
            <div className="flex justify-between text-meta text-muted-foreground">
              <span>{node.label}</span>
              <span className="tabular-nums">
                {Math.round((clamp(node.value, node.max) / node.max) * 100)}%
              </span>
            </div>
          )}
          <Progress
            value={node.value}
            max={node.max}
            aria-label={node.label ?? "Progress"}
          />
        </div>
      )
    case "Form":
      return <FormNode form={node} send={send} />
    case "Button":
      return (
        <ActButton
          doing={node}
          send={send}
          variant={node.tone === "bad" ? "destructive" : "outline"}
        />
      )
    case "Link":
      return <LinkNode link={node} />
    case "Badge":
      return (
        <Badge variant="outline" className={toneBadge(node.tone)}>
          {node.text}
        </Badge>
      )
    case "Alert": {
      const { variant, Icon } = ALERT[node.tone] ?? ALERT.plain
      return (
        <Alert variant={variant}>
          <Icon />
          <AlertTitle>{node.title}</AlertTitle>
          {node.about && <AlertDescription>{node.about}</AlertDescription>}
        </Alert>
      )
    }
    case "Empty":
      return <Nothing title={node.title} about={node.about} />
    case "Separator":
      return <Separator />
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
})

function LinkNode({ link }: { link: TreeLink }) {
  const opening = useContext(Opening)
  return (
    <div data-slot="tree-link">
      <Button
        type="button"
        variant="link"
        size="sm"
        className="px-0"
        onClick={() => opening?.(link.view, opensWith(link))}
      >
        {link.label}
        <ChevronRightIcon />
      </Button>
    </div>
  )
}

function StatNode({ stat }: { stat: TreeStat }) {
  return (
    <div
      data-slot="tree-stat"
      className={cn(FRAME, "flex flex-col gap-1 bg-card p-3")}
    >
      <span className="text-meta text-muted-foreground">{stat.label}</span>
      <span className="text-heading font-semibold tabular-nums">
        {typeof stat.value === "number"
          ? stat.value.toLocaleString()
          : stat.value}
      </span>
      {stat.about && (
        <span
          className={cn(
            "text-meta",
            toneText(stat.tone) ?? "text-muted-foreground"
          )}
        >
          {stat.about}
        </span>
      )}
    </div>
  )
}

function TabsNode({ tabs, send }: { tabs: TreeTabs; send: Send }) {
  const [chosen, setChosen] = useState(0)
  return (
    // The Tree read again may have fewer: the last one then.
    <Tabs
      value={Math.min(chosen, tabs.tabs.length - 1)}
      onValueChange={(value) => setChosen(Number(value))}
    >
      <TabsList>
        {tabs.tabs.map((tab, place) => (
          <TabsTrigger key={place} value={place}>
            {tab.title}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.tabs.map((tab, place) => (
        // Kept while another is shown: a Form in it holds what was typed.
        <TabsContent key={place} value={place} keepMounted>
          <Nodes nodes={tab.children} send={send} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

function AccordionNode({
  accordion,
  send,
}: {
  accordion: TreeAccordion
  send: Send
}) {
  return (
    <Accordion className={cn(FRAME, "px-3")}>
      {accordion.items.map((item, place) => (
        <AccordionItem key={place} value={place}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent keepMounted>
            <Nodes nodes={item.children} send={send} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

function DialogNode({ dialog, send }: { dialog: TreeDialog; send: Send }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div data-slot="tree-dialog">
        <DialogTrigger render={<Button type="button" size="sm" />}>
          {dialog.label}
        </DialogTrigger>
      </div>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialog.title}</DialogTitle>
          {dialog.about && (
            <DialogDescription>{dialog.about}</DialogDescription>
          )}
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
          <Closing value={() => setOpen(false)}>
            <Nodes nodes={dialog.children} send={send} />
          </Closing>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ListNode({ list, send }: { list: TreeList; send: Send }) {
  const opening = useContext(Opening)
  if (list.items.length === 0 && list.empty)
    return <Nothing title={list.empty} />
  return (
    <ItemGroup data-slot="tree-list" className={FRAME}>
      {list.items.map((item, place) => {
        const actions = item.actions ?? []
        return (
          <Item key={place} size="sm">
            <ItemContent>
              <ItemTitle>
                {item.open && opening ? (
                  <button
                    type="button"
                    className="rounded-control text-left outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() =>
                      item.open && opening(item.open.view, opensWith(item.open))
                    }
                  >
                    {item.title}
                  </button>
                ) : (
                  item.title
                )}
              </ItemTitle>
              {item.about && <ItemDescription>{item.about}</ItemDescription>}
            </ItemContent>
            {(item.badge || actions.length > 0) && (
              <ItemActions>
                {item.badge && (
                  <Badge variant="outline" className={toneBadge(item.tone)}>
                    {item.badge}
                  </Badge>
                )}
                {actions.map((action, at) => (
                  <ActButton
                    key={at}
                    doing={action}
                    send={send}
                    variant="ghost"
                    size="xs"
                  />
                ))}
              </ItemActions>
            )}
          </Item>
        )
      })}
    </ItemGroup>
  )
}
