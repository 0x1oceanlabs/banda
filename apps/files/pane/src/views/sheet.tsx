/**
 * Files' workbooks (ADR 0073, decision 6): an xlsx, xls or ods sheet as a
 * table, as a CSV is drawn, its sheets as tabs at the foot. The engine
 * reads it (`files.sheet`, on `calamine`), at most 10 000 rows, the
 * values the workbook kept: no formula is worked out again.
 */
import { useState } from "react"
import { Button } from "@banda/ui/components/button"
import { cn } from "@banda/ui/lib/utils"
import type { PreviewProps } from "@banda/ui/module"
import { FileWarningIcon } from "lucide-react"
import { Card, Loading } from "../Facts"
import { countWords } from "../words"
import { BLOCK_ROWS, Table } from "./table"
import { useAnswer } from "./whole"

export default function SheetView({ file, engine, project }: PreviewProps) {
  const [asked, setAsked] = useState<{ path: string; sheet: string } | null>(
    null
  )
  const sheet = asked?.path === file.path ? asked.sheet : undefined
  const read = useAnswer(`${file.path}\0${file.modified}\0${sheet ?? ""}`, () =>
    engine.call(
      "files.sheet",
      { path: file.path, ...(sheet !== undefined && { sheet }) },
      { project }
    )
  )
  if (read === null) return <Loading />
  if ("refused" in read)
    return (
      <Card
        icon={<FileWarningIcon />}
        title="This workbook cannot be read"
        note={read.refused}
      />
    )
  const { rows, sheets, truncated } = read.answer
  return (
    <Table
      // Each sheet sized anew.
      key={read.answer.sheet}
      label={read.answer.sheet}
      count={rows.length}
      row={(index) => rows[index]}
      want={() => undefined}
      first={rows.slice(0, BLOCK_ROWS)}
      foot={
        <>
          {sheets.length > 1 && (
            <span role="tablist" aria-label="Sheets" className="flex gap-0.5">
              {sheets.map((name) => (
                <Button
                  key={name}
                  role="tab"
                  aria-selected={name === read.answer.sheet}
                  size="xs"
                  variant="ghost"
                  className={cn(
                    "h-5 px-1.5",
                    name === read.answer.sheet
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground"
                  )}
                  onClick={() => setAsked({ path: file.path, sheet: name })}
                >
                  {name}
                </Button>
              ))}
            </span>
          )}
          <span>
            {countWords(Math.max(0, rows.length - 1), "row")}
            {truncated && " · only its first 10,000 rows and 500 columns"}
          </span>
        </>
      }
    />
  )
}
