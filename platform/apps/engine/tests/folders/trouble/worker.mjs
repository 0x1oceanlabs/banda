const keep = (word) => ({
  sql: "INSERT INTO trouble_words (word) VALUES (?)",
  params: [word],
})

export const methods = {
  keep: ({ word }) => ({ answer: word, write: [keep(word)] }),
  kept: async (_, { read }) => ({
    answer: (await read("SELECT word FROM trouble_words ORDER BY rowid")).map(
      (row) => row.word
    ),
  }),
  stray: ({ word }) => ({
    write: [
      keep(word),
      { sql: "INSERT INTO clients_people (name, added_at) VALUES ('x', 0)" },
    ],
  }),
  peek: async (_, { read }) => {
    try {
      return { answer: await read("SELECT * FROM kernel_events") }
    } catch (error) {
      return { answer: { refused: error.message } }
    }
  },
  scribble: ({ word }) => ({ write: [keep(word)] }),
  slow: () => new Promise(() => {}),
  die: () => process.exit(7),
  fail: () => {
    throw new TypeError("it broke")
  },
  who: (_, { by, project }) => ({ answer: { by, project } }),
  mess: () => ({
    answer: { title: "Words", children: [{ node: "Tabel", rows: [] }] },
  }),
}
