/**
 * What the Tiling's section draws itself (ADR 0016, decision 4; ADR 0127,
 * decision 4), where `tiling.toml`'s schema alone draws less well: a list
 * of shares as one field, and the rules by kind of Pane, named as the
 * file has them now and written there.
 */
import type { JsonValue } from "@banda/contract"
import { type Row, rowsOf, tomlOf } from "@banda/contract/settings"
import { type Rule, TILING_FILE } from "@banda/contract/workspaces"
import { Button } from "@banda/ui/components/button"
import { useFile } from "@banda/ui/lib/look"
import { ExternalLinkIcon } from "lucide-react"
import { device } from "../boot"
import type { CustomRow, SectionProps } from "@banda/ui/settings"
import { Group, RowFrame } from "@banda/ui/components/setting-row"
import { Field } from "./SettingRow"

/** A list of shares, `columns.presets`, as one field: `1/3, 1/2, 2/3, 1`.
 * What is no share the file's own check refuses, and the row says so. */
export const Shares: CustomRow = ({ row, setting, set }) => (
  <Field
    label={row.title}
    className="w-48"
    value={sharesOf(setting?.value).join(", ")}
    onCommit={(text) => set(tomlOf(text.split(/[\s,]+/).filter(Boolean)))}
  />
)

function sharesOf(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

const OPENS: { [opens in NonNullable<Rule["opens"]>]: string } = {
  beside: "beside",
  below: "below",
  group: "in its Group",
  project: "on its Project's workspace",
}

/** One rule in a few words: `terminal.terminal: 1/3 wide, below.` The kind
 * is named as the file names its table. */
export function ruleWords(kind: string, rule: Rule): string {
  const says = [
    rule.width && `${rule.width} wide`,
    rule.opens && OPENS[rule.opens],
  ].filter(Boolean)
  return `${kind}: ${says.join(", ")}.`
}

/** The row of the rules, for a search to find and a link to name. */
export const RULES_ROW: Row = {
  ...rowsOf(TILING_FILE.name).find((row) => row.key === "rule")!,
  title: "Rules by kind of Pane",
  about:
    "How wide a new column for a kind of Pane opens, and where: written in tiling.toml.",
}

/** The rules the file has now, each in a few words, and the file to
 * write one in: a rule has no row of its own. */
export function TilingRules({ lit }: SectionProps) {
  const rules = Object.entries(useFile(TILING_FILE).rules)
  const count =
    rules.length === 0
      ? "No rules"
      : `${rules.length} ${rules.length === 1 ? "rule" : "rules"}`
  return (
    <Group title={RULES_ROW.title}>
      <RowFrame
        dataKey={RULES_ROW.key}
        lit={lit === RULES_ROW.key}
        title={count}
        about={
          rules.length === 0
            ? "A kind of Pane opens as its App and the Flow say. A rule is written in the file."
            : rules.map(([kind, rule]) => ruleWords(kind, rule!)).join(" ")
        }
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => device.settings.reveal(TILING_FILE.name)}
        >
          <ExternalLinkIcon />
          Open file
        </Button>
      </RowFrame>
    </Group>
  )
}
