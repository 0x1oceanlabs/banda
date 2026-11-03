/**
 * The sites Agents may use in the browser without asking, or never (ADR
 * 0029, decision 7, B): `browser.toml`'s `[agents.sites]`, which the
 * Person's answers on a tab write. A line changes between the two, or ↶
 * takes it out, so Agents ask again. `banda settings` writes the file, and
 * the look brings the sites back.
 */
import { BROWSER_FILE, type SiteRule } from "@banda/contract/browser"
import { tomlOf } from "@banda/contract/settings"
import { useWrite } from "@banda/ui/hooks/use-write"
import { useFile } from "@banda/ui/lib/look"
import type { SectionProps } from "./sections"
import { Choice, Group, RowFrame } from "./SettingRow"

const RULES = [{ value: "allow" }, { value: "deny" }]

export function BrowserSites({ lit }: SectionProps) {
  const { sites } = useFile(BROWSER_FILE)
  const all = Object.entries(sites)
  return (
    <div className="flex flex-col gap-1.5">
      <Group title="Sites for Agents">
        {all.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No sites yet: an Agent asks on the tab before it first uses one.
          </p>
        ) : (
          all.map(([site, rule]) => (
            <Site key={site} site={site} rule={rule} lit={lit} />
          ))
        )}
      </Group>
      <p className="px-1 text-xs text-muted-foreground">
        A site covers its subdomains. “Once” lasts for its Thread until Banda
        restarts; localhost never asks.
      </p>
    </div>
  )
}

/** One site: allowed or denied, and ↶. */
function Site({
  site,
  rule,
  lit,
}: {
  site: string
  rule: SiteRule
  /** The key a link names. */
  lit?: string
}) {
  const { refused, write } = useWrite({ against: rule })
  const settings = window.banda?.settings
  const key = `agents.sites.${JSON.stringify(site)}`
  return (
    <RowFrame
      dataKey={key}
      lit={key === lit}
      title={site}
      file={BROWSER_FILE.name}
      from={{ layer: "file" }}
      onReset={() => settings && write(settings.reset(BROWSER_FILE.name, key))}
      wrong={refused}
    >
      <Choice
        label={`${site} for Agents`}
        options={RULES}
        value={rule}
        onPick={(picked) =>
          settings &&
          write(settings.set(BROWSER_FILE.name, key, tomlOf(picked)))
        }
      />
    </RowFrame>
  )
}
