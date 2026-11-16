// The deals App's code: a screen of every node a Tree has.

const DEALS =
  "SELECT id, client, amount, stage, due, chance, paid FROM deals_all"

export const methods = {
  async add(
    { client, amount, stage = "new", due = null, chance = 50, paid = false },
    { read }
  ) {
    const [{ next }] = await read(
      "SELECT COALESCE(MAX(id), 0) + 1 AS next FROM deals_all"
    )
    const deal = { id: next, client, amount, stage, due, chance, paid }
    return {
      answer: deal,
      write: [
        {
          sql: "INSERT INTO deals_all (id, client, amount, stage, due, chance, paid) VALUES (?, ?, ?, ?, ?, ?, ?)",
          params: [next, client, amount, stage, due, chance, paid ? 1 : 0],
        },
      ],
      emit: [{ kind: "added", subject: String(next), payload: deal }],
    }
  },

  async update({ id, ...changes }, { read, refuse }) {
    const [found] = await read(`${DEALS} WHERE id = ?`, [id])
    if (!found) throw refuse("not_found", `No deal has the id ${id}.`)
    const deal = { ...found, paid: found.paid === 1, ...changes }
    return {
      answer: deal,
      write: [
        {
          sql: "UPDATE deals_all SET client = ?, amount = ?, stage = ?, due = ?, chance = ?, paid = ? WHERE id = ?",
          params: [
            deal.client,
            deal.amount,
            deal.stage,
            deal.due,
            deal.chance,
            deal.paid ? 1 : 0,
            id,
          ],
        },
      ],
      emit: [{ kind: "changed", subject: String(id), payload: changes }],
    }
  },

  async remove({ id }, { read, refuse }) {
    const [found] = await read(`${DEALS} WHERE id = ?`, [id])
    if (!found) throw refuse("not_found", `No deal has the id ${id}.`)
    return {
      answer: { client: found.client },
      write: [{ sql: "DELETE FROM deals_all WHERE id = ?", params: [id] }],
      emit: [{ kind: "removed", subject: String(id), payload: {} }],
    }
  },

  async list(_, { read }) {
    return { answer: await read(`${DEALS} ORDER BY amount DESC`) }
  },

  async home(_, { read }) {
    const deals = (await read(`${DEALS} ORDER BY amount DESC`)).map((deal) => ({
      ...deal,
      paid: deal.paid === 1,
    }))
    const open = deals.filter((deal) => !["won", "lost"].includes(deal.stage))
    const won = deals.filter((deal) => deal.stage === "won")
    const counted = (count) => `${count} ${count === 1 ? "deal" : "deals"}`
    const sum = (some) => some.reduce((all, deal) => all + deal.amount, 0)
    const late = open.filter(
      (deal) => deal.due && deal.due < new Date().toISOString().slice(0, 10)
    )
    const stages = ["new", "talks", "won", "lost"].map((stage) => {
      const of = deals.filter((deal) => deal.stage === stage)
      return { stage, deals: of.length, amount: sum(of) }
    })
    const table = (rows) => ({
      node: "Table",
      search: true,
      empty: "No deals here yet",
      rows,
      columns: [
        { key: "client", title: "Client" },
        { key: "amount", title: "Amount" },
        {
          key: "stage",
          title: "Stage",
          as: "badge",
          tones: { won: "good", talks: "warn", lost: "bad" },
        },
        { key: "due", title: "Due" },
        { key: "chance", title: "Chance", as: "progress" },
        { key: "paid", title: "Paid", as: "check" },
      ],
      actions: [
        {
          label: "Edit",
          submit: "Save",
          command: "update",
          take: {
            id: "id",
            client: "client",
            amount: "amount",
            stage: "stage",
            due: "due",
            chance: "chance",
            paid: "paid",
          },
          fields: [
            { name: "client" },
            { name: "amount" },
            { name: "stage", kind: "radio" },
            { name: "due" },
            { name: "chance", kind: "slider" },
            { name: "paid", kind: "switch" },
          ],
        },
        {
          label: "Won",
          command: "update",
          take: { id: "id" },
          params: { stage: "won" },
          tone: "good",
        },
        {
          label: "Delete",
          command: "remove",
          take: { id: "id" },
          confirm: "Delete this deal? It can't be undone.",
          tone: "bad",
        },
      ],
    })
    return {
      answer: {
        title: "Deals",
        about: "What is being sold, to whom, and how far along each sale is.",
        children: [
          ...(late.length > 0
            ? [
                {
                  node: "Alert",
                  tone: "warn",
                  title: `${late.length} open ${late.length === 1 ? "deal is" : "deals are"} past due`,
                  about: late.map((deal) => deal.client).join(", "),
                },
              ]
            : []),
          {
            node: "Grid",
            columns: 4,
            children: [
              { node: "Stat", label: "Open", value: open.length },
              {
                node: "Stat",
                label: "In talks, €",
                value: sum(open),
                about: counted(open.length),
              },
              {
                node: "Stat",
                label: "Won, €",
                value: sum(won),
                about: counted(won.length),
                tone: "good",
              },
              {
                node: "Card",
                children: [
                  {
                    node: "Progress",
                    label: "Of this quarter's 100,000",
                    value: sum(won),
                    max: 100000,
                  },
                ],
              },
            ],
          },
          {
            node: "Tabs",
            tabs: [
              { title: "Open", children: [table(open)] },
              { title: "All", children: [table(deals)] },
              {
                title: "By stage",
                children: [
                  {
                    node: "Grid",
                    columns: 2,
                    children: [
                      {
                        node: "Chart",
                        kind: "bar",
                        title: "Amount by stage, €",
                        x: "stage",
                        series: [{ key: "amount", title: "Amount" }],
                        rows: stages,
                      },
                      {
                        node: "Chart",
                        kind: "pie",
                        title: "Deals by stage",
                        x: "stage",
                        series: [{ key: "deals", title: "Deals" }],
                        rows: stages,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            node: "Dialog",
            label: "Add a deal",
            title: "Add a deal",
            about: "The client and the amount are enough to start.",
            children: [
              {
                node: "Form",
                command: "add",
                submit: "Add deal",
                values: { stage: "new", chance: 50 },
                fields: [
                  { name: "client", placeholder: "Who buys" },
                  { name: "amount", about: "In euros." },
                  { name: "stage" },
                  { name: "due" },
                  { name: "chance", kind: "slider" },
                  { name: "paid", kind: "switch" },
                ],
              },
            ],
          },
          {
            node: "Accordion",
            items: [
              {
                title: "How the stages go",
                children: [
                  {
                    node: "Markdown",
                    text: "A deal is **new**, then in **talks**, then **won** or **lost**.",
                  },
                  { node: "Separator" },
                  {
                    node: "List",
                    items: stages.map((stage) => ({
                      title: stage.stage,
                      about: `${stage.amount.toLocaleString("en")} €`,
                      badge: String(stage.deals),
                      tone:
                        stage.stage === "won"
                          ? "good"
                          : stage.stage === "lost"
                            ? "bad"
                            : "plain",
                    })),
                  },
                ],
              },
            ],
          },
        ],
      },
    }
  },
}
