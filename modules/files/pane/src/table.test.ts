import { expect, test } from "vitest"
import {
  numericColumns,
  parseRows,
  RowStarts,
  shownCell,
  sniff,
  widthsOf,
} from "./table"

const bytes = (text: string) => new TextEncoder().encode(text)

test("a row's cells are parted by the delimiter, and a quoted cell holds it, a line break and a quote written twice", () => {
  const text = [
    "name,notes,count",
    'pear,"sweet, green",3',
    '"plum","said ""ripe""",4',
    'fig,"two\nlines",5',
    'kiwi,,"6"',
  ].join("\r\n")
  expect(parseRows(text + "\r\n", ",")).toEqual([
    ["name", "notes", "count"],
    ["pear", "sweet, green", "3"],
    ["plum", 'said "ripe"', "4"],
    ["fig", "two\nlines", "5"],
    ["kiwi", "", "6"],
  ])
  // No line break at the end: the last row is there all the same.
  expect(parseRows("a\tb\n1\t2", "\t")).toEqual([
    ["a", "b"],
    ["1", "2"],
  ])
  expect(parseRows("", ",")).toEqual([])
  expect(parseRows("a,\n", ",")).toEqual([["a", ""]])
  // A quote inside a plain cell is the cell's, and a CR in quotes too.
  expect(parseRows('5" screen,"a\r"\n', ",")).toEqual([['5" screen', "a\r"]])
})

test("the delimiter is the one that parts the first rows alike", () => {
  expect(sniff("a,b,c\n1,2,3\n4,5,6\n")).toBe(",")
  expect(sniff("a\tb\n1\t2\n")).toBe("\t")
  expect(sniff("name;price\npear;1,5\nplum;2,25\n")).toBe(";")
  // Commas inside quotes part nothing.
  expect(sniff('"a, b";c\n"d, e";f\n')).toBe(";")
  // A TSV of one column is still a TSV; a lone word is a comma's.
  expect(sniff("words\nmore\n", "tsv")).toBe("\t")
  expect(sniff("words\n")).toBe(",")
  // A cut last line does not count.
  expect(sniff("a|b|c\n1|2|3\n4|5")).toBe("|")
})

test("rows start where a line break outside quotes ends the last, however the bytes come in pieces", () => {
  const text = 'h1,h2\r\n"a\nb",1\r\nc,"x""y"\r\n\r\nd,2'
  const whole = bytes(text)
  for (const size of [1, 3, 7, whole.length]) {
    const starts = new RowStarts(",")
    for (let at = 0; at < whole.length; at += size)
      starts.push(whole.subarray(at, at + size))
    expect(starts.count).toBe(5)
    const rows = Array.from({ length: starts.count }, (_, n) =>
      new TextDecoder().decode(whole.subarray(starts.start(n), starts.end(n)))
    )
    expect(rows).toEqual([
      "h1,h2\r\n",
      '"a\nb",1\r\n',
      'c,"x""y"\r\n',
      "\r\n",
      "d,2",
    ])
    expect(parseRows(rows[1], ",")).toEqual([["a\nb", "1"]])
  }
  // A line break at the very end starts no row.
  const ended = new RowStarts(",")
  ended.push(bytes("a\nb\n"))
  expect(ended.count).toBe(2)
})

test("past its most rows it stops, and the last row kept ends where it stopped", () => {
  const starts = new RowStarts(",", 2)
  starts.push(bytes("a\nb\nc\nd\n"))
  expect(starts.count).toBe(2)
  expect(starts.full).toBe(true)
  expect(starts.end(1)).toBe(4)
})

test("a column is as wide as its widest cell, within bounds, and one of numbers is told", () => {
  const rows = [
    ["id", "name", "price"],
    ["1", "a very long name indeed", "1,200.50"],
    ["22", "b", "-3e2"],
    ["3", "two\nlines", ""],
  ]
  const measure = (text: string) => text.length * 10
  expect(widthsOf(rows, measure, 30, 200)).toEqual([30, 200, 80])
  expect(numericColumns(rows)).toEqual([true, false, true])
  expect(numericColumns([["a"], ["1.2.3"]])).toEqual([false])
  expect(shownCell("two\r\nlines")).toBe("two ↵ lines")
})
