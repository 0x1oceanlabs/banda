// The clients App's code. Banda calls each method with its params and
// what the call gives: `read` for the App's own tables, `refuse` for a
// refusal, `by` and `project`. A method answers `{ answer, write, emit }`:
// Banda does the writing, in one transaction.

const PEOPLE = "SELECT id, name, city, email FROM clients_people"

export const methods = {
  async add({ name, city = null, email = null }, { read }) {
    // One command of this App runs at a time in a Project, so the next id
    // read here is still free as the write lands.
    const [{ next }] = await read(
      "SELECT COALESCE(MAX(id), 0) + 1 AS next FROM clients_people"
    )
    const client = { id: next, name, city, email }
    return {
      answer: client,
      write: [
        {
          sql: "INSERT INTO clients_people (id, name, city, email, added_at) VALUES (?, ?, ?, ?, ?)",
          params: [next, name, city, email, Date.now()],
        },
      ],
      emit: [{ kind: "added", subject: String(next), payload: client }],
    }
  },

  async find({ city, text }, { read }) {
    const where = []
    const params = []
    if (city) {
      where.push("city = ? COLLATE NOCASE")
      params.push(city)
    }
    if (text) {
      where.push("(name LIKE ? OR email LIKE ?)")
      params.push(`%${text}%`, `%${text}%`)
    }
    const sql = `${PEOPLE}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY name`
    return { answer: await read(sql, params) }
  },

  async note({ client, text }, { read, refuse }) {
    const [found] = await read(`${PEOPLE} WHERE id = ?`, [client])
    if (!found) throw refuse("not_found", `No client has the id ${client}.`)
    return {
      answer: { client: found.name },
      write: [
        {
          sql: "INSERT INTO clients_notes (client, text, at) VALUES (?, ?, ?)",
          params: [client, text, Date.now()],
        },
      ],
      emit: [{ kind: "noted", subject: String(client), payload: { text } }],
    }
  },

  async notes({ client }, { read }) {
    const sql =
      "SELECT text, at FROM clients_notes WHERE client = ? ORDER BY id DESC"
    return { answer: await read(sql, [client]) }
  },

  // The App's screen: a Tree, which Banda draws. The form's fields come
  // from the params of `add`, the command it sends.
  async home(_, { read }) {
    const rows = await read(
      `SELECT p.name, p.city, p.email,
              (SELECT COUNT(*) FROM clients_notes n WHERE n.client = p.id) AS notes
       FROM clients_people p ORDER BY p.name`
    )
    return {
      answer: {
        title: "Clients",
        about:
          "The people I work with: who they are, where, and notes on each.",
        children: [
          {
            node: "Table",
            rows: rows.map((row) => ({ ...row, notes: row.notes || null })),
            empty: "No clients yet",
            columns: [
              { key: "name", title: "Name" },
              { key: "city", title: "City" },
              { key: "email", title: "Email" },
              { key: "notes", title: "Notes", as: "badge" },
            ],
          },
          {
            node: "Card",
            title: "Add a client",
            children: [{ node: "Form", command: "add", submit: "Add client" }],
          },
        ],
      },
    }
  },
}
