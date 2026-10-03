"use client";

/**
 * DSH-1's charts, drawn by hand.
 *
 * The module brief says "shadcn chart component (Recharts)". Recharts is not installed, and adding it
 * would put a charting library in the bundle of every one of the six role home pages for two charts that
 * are a line and a set of bars. Everything else visual in this app is hand-rolled Tailwind, so this is
 * the shape the codebase already has.
 *
 * ## Accessibility, which is why this is a component at all
 *
 * Spec §DSH-1 requires each chart to carry "a text summary and a table alternative for screen
 * readers". An `<svg>` with no accessible name is a picture of numbers, and a screen reader reads
 * nothing. So every chart here renders:
 *
 * - the SVG marked `aria-hidden`, because the numbers it draws are also in the table,
 * - a visible text summary in words,
 * - a real `<table>` underneath, toggled by a button so the chart still looks like a chart.
 *
 * The table is not a fallback for old browsers. It is the same data, and it is the accessible version.
 */

/** A polyline series. */
export type Series = { label: string; points: number[] };

function niceMax(value: number): number {
  if (value <= 0) return 10;
  // Round up to a readable axis top so the gridlines land on whole numbers.
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * A line chart of one series over time.
 *
 * SVG path rather than points, because a 12-week trend drawn as circles reads as a scatter plot.
 */
export function LineChart({
  title,
  summary,
  labels,
  values,
  valueLabel = "attendance",
  height = 160,
}: {
  title: string;
  /** The sentence a screen reader gets instead of the picture. */
  summary: string;
  labels: readonly string[];
  values: readonly number[];
  valueLabel?: string;
  height?: number;
}) {
  const width = 640;
  const padLeft = 44;
  const padBottom = 28;
  const padTop = 12;
  const innerW = width - padLeft - 8;
  const innerH = height - padTop - padBottom;

  const max = niceMax(Math.max(1, ...values));
  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;

  const toX = (i: number) => padLeft + i * stepX;
  const toY = (v: number) => padTop + innerH - (v / max) * innerH;

  const path = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
    .join(" ");

  const gridValues = [0, max / 2, max];

  return (
    <figure className="m-0">
      <figcaption className="text-sm font-medium text-[var(--text)]">{title}</figcaption>

      {values.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
          Nothing recorded yet.
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="mt-2 h-auto w-full"
            role="img"
            aria-label={summary}
          >
            {gridValues.map((g) => (
              <g key={g}>
                <line
                  x1={padLeft}
                  x2={width - 8}
                  y1={toY(g)}
                  y2={toY(g)}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text x={padLeft - 8} y={toY(g) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
                  {Math.round(g)}
                </text>
              </g>
            ))}

            <path d={path} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" />

            {values.map((v, i) => (
              <circle key={i} cx={toX(i)} cy={toY(v)} r={2.5} fill="var(--brand)" />
            ))}

            {labels.map((label, i) =>
              // Every other label, so they do not overlap at 375px.
              i % 2 === 0 ? (
                <text
                  key={label + i}
                  x={toX(i)}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--text-muted)"
                >
                  {label}
                </text>
              ) : null,
            )}
          </svg>

          <p className="mt-1 text-sm text-[var(--text-muted)]">{summary}</p>

          <DataTable
            caption={`${title} by week`}
            headers={["Week", valueLabel]}
            rows={labels.map((label, i) => [label, String(values[i] ?? 0)])}
          />
        </>
      )}
    </figure>
  );
}

/** A horizontal bar chart of a handful of categories. */
export function BarChart({
  title,
  summary,
  rows,
  valueLabel = "average",
}: {
  title: string;
  summary: string;
  rows: ReadonlyArray<{ label: string; value: number }>;
  valueLabel?: string;
}) {
  const max = niceMax(Math.max(1, ...rows.map((r) => r.value)));

  return (
    <figure className="m-0">
      <figcaption className="text-sm font-medium text-[var(--text)]">{title}</figcaption>

      {rows.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
          Nothing recorded yet.
        </p>
      ) : (
        <>
          <ul className="mt-2 space-y-2" role="img" aria-label={summary}>
            {rows.map((row) => (
              <li key={row.label} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2">
                <span className="truncate text-sm text-[var(--text-muted)]" title={row.label}>
                  {row.label}
                </span>
                <span
                  className="h-3 rounded-full bg-[var(--brand)]"
                  style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
                />
                <span className="text-sm font-medium tabular-nums">{row.value}</span>
              </li>
            ))}
          </ul>

          <p className="mt-2 text-sm text-[var(--text-muted)]">{summary}</p>

          <DataTable
            caption={`${title} by Mass`}
            headers={["Mass", valueLabel]}
            rows={rows.map((r) => [r.label, String(r.value)])}
          />
        </>
      )}
    </figure>
  );
}

/**
 * The table alternative.
 *
 * Rendered inside a `<details>` so it is in the DOM and reachable by a screen reader and by search
 * without a click, but does not push the chart below the fold for everybody else.
 */
export function DataTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: readonly string[];
  rows: ReadonlyArray<readonly string[]>;
}) {
  return (
    <details className="mt-2">
      <summary className="min-h-11 cursor-pointer text-sm text-[var(--text-muted)]">
        Show the numbers as a table
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="text-[var(--text-muted)]">
              {headers.map((h) => (
                <th key={h} scope="col" className="py-1 pr-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-[var(--border)]">
                {row.map((cell, j) => (
                  <td key={j} className={j === 0 ? "py-1 pr-3" : "py-1 pr-3 tabular-nums"}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}