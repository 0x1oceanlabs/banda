/** A Chart of an App's screen, drawn in the theme's chart colours. */
import type { TreeChart } from "@banda/contract/apps"
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@banda/ui/components/chart"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"
import { memo, useMemo } from "react"

/** The theme's chart colours, taken in turn. */
const COLOURS = 5
const colour = (place: number) => `var(--chart-${(place % COLOURS) + 1})`

/** A number as an axis has room for: 45000 as "45K". */
const SHORT = new Intl.NumberFormat(undefined, { notation: "compact" })
const short = (value: number) => SHORT.format(value)

/** The key of a row's name in what is drawn. */
const NAME = "name"

const margin = { top: 6, right: 6, left: 0, bottom: 0 }

/** What is drawn of `chart`, by keys made here. */
function drawnOf(chart: TreeChart) {
  const pie = chart.kind === "pie"
  // What the App named goes in as words only. The keys the chart's
  // styles are written from are made here: `s0` for the first series,
  // `p0` for a pie's first part.
  const series = chart.series.map((one, place) => ({
    key: `s${place}`,
    from: one.key,
    title: one.title,
  }))
  const data = chart.rows.map((row, place) => ({
    [NAME]: `${row[chart.x] ?? ""}`,
    part: `p${place}`,
    ...Object.fromEntries(series.map((one) => [one.key, row[one.from]])),
  }))
  const config: ChartConfig = Object.fromEntries(
    pie
      ? data.map((row, place) => [
          row.part,
          { label: row[NAME], color: colour(place) },
        ])
      : series.map((one, place) => [
          one.key,
          { label: one.title, color: colour(place) },
        ])
  )
  return { series, data, config }
}

export const ChartNode = memo(function ChartNode({
  chart,
}: {
  chart: TreeChart
}) {
  const { series, data, config } = useMemo(() => drawnOf(chart), [chart])
  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey={NAME}
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        minTickGap={24}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={44}
        tickCount={4}
        tickFormatter={short}
      />
      <ChartTooltip content={<ChartTooltipContent />} />
      {series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
    </>
  )
  const drawn = () => {
    switch (chart.kind) {
      case "pie": {
        return (
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="part" />} />
            <ChartLegend content={<ChartLegendContent nameKey="part" />} />
            <Pie
              data={data}
              dataKey={series[0]!.key}
              nameKey="part"
              innerRadius="45%"
              stroke="var(--background)"
              isAnimationActive={false}
            >
              {data.map((_, place) => (
                <Cell key={place} fill={colour(place)} />
              ))}
            </Pie>
          </PieChart>
        )
      }
      case "line":
        return (
          <LineChart data={data} margin={margin}>
            {axes}
            {series.map((one, place) => (
              <Line
                key={one.key}
                dataKey={one.key}
                type="monotone"
                stroke={colour(place)}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )
      case "area":
        return (
          <AreaChart data={data} margin={margin}>
            {axes}
            {series.map((one, place) => (
              <Area
                key={one.key}
                dataKey={one.key}
                type="monotone"
                stroke={colour(place)}
                strokeWidth={1.5}
                fill={colour(place)}
                fillOpacity={0.16}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        )
      default:
        return (
          <BarChart data={data} margin={margin}>
            {axes}
            {series.map((one, place) => (
              <Bar
                key={one.key}
                dataKey={one.key}
                fill={colour(place)}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        )
    }
  }
  return (
    <figure data-slot="tree-chart" className="flex flex-col gap-2">
      {chart.title && (
        <figcaption className="text-ui font-semibold">{chart.title}</figcaption>
      )}
      <ChartContainer config={config} className="aspect-auto h-60 w-full">
        {drawn()}
      </ChartContainer>
    </figure>
  )
})
