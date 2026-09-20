/**
 * Server-rendered SVG charts for the newsroom.
 *
 * No charting library: these are a few hundred lines, render on the
 * server with no JavaScript (which the CSP likes), take their colours
 * from the design tokens so they are right in dark mode, and every one
 * has a screen-reader table behind it. Hover tooltips are native
 * <title> elements — modest, but they work everywhere.
 */

export interface Point {
  label: string;
  value: number;
}

const fmt = (n: number) => n.toLocaleString("en-GB");

function niceMax(max: number): number {
  if (max <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalised = max / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

function DataTable({ caption, rows }: { caption: string; rows: Point[] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Label</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td>{r.label}</td>
            <td>{fmt(r.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A filled line over time. `compare` draws a second, dotted series (the
 * previous period) behind it so a change is visible without a legend.
 */
export function AreaChart({
  title,
  series,
  compare,
  height = 220,
  labelEvery,
}: {
  title: string;
  series: Point[];
  compare?: Point[];
  height?: number;
  /** Show every nth x label; defaults to about eight labels across. */
  labelEvery?: number;
}) {
  const width = 720;
  const pad = { top: 16, right: 12, bottom: 28, left: 44 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const n = Math.max(1, series.length);
  const max = niceMax(Math.max(...series.map((p) => p.value), ...(compare ?? []).map((p) => p.value), 1));
  const x = (i: number) => pad.left + (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => pad.top + h - (v / max) * h;
  const path = (pts: Point[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${path(series)} L${x(n - 1).toFixed(1)},${(pad.top + h).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + h).toFixed(1)} Z`;
  const every = labelEvery ?? Math.max(1, Math.round(n / 8));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const gradientId = `area-${title.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
  const total = series.reduce((s, p) => s + p.value, 0);

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`${title}: ${fmt(total)} in total`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : "2 4"} />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">
              {fmt(t)}
            </text>
          </g>
        ))}
        {compare && compare.length > 1 && (
          <path d={path(compare)} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="3 4" opacity="0.7" />
        )}
        {series.length > 1 && <path d={area} fill={`url(#${gradientId})`} />}
        <path d={path(series)} fill="none" stroke="var(--accent)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
        {series.map((p, i) => (
          <g key={p.label}>
            <circle cx={x(i)} cy={y(p.value)} r={n > 40 ? 2 : 3.5} fill="var(--surface)" stroke="var(--accent)" strokeWidth="2">
              <title>{`${p.label}: ${fmt(p.value)}${compare?.[i] ? ` (previous: ${fmt(compare[i]!.value)})` : ""}`}</title>
            </circle>
            {/* A wide invisible hit area so the tooltip is easy to reach. */}
            <rect x={x(i) - w / n / 2} y={pad.top} width={w / n} height={h} fill="transparent">
              <title>{`${p.label}: ${fmt(p.value)}${compare?.[i] ? ` (previous: ${fmt(compare[i]!.value)})` : ""}`}</title>
            </rect>
            {i % every === 0 && (
              <text x={x(i)} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--ink-3)">
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <DataTable caption={title} rows={series} />
    </figure>
  );
}

/** Vertical bars — one per label. */
export function BarChart({
  title,
  series,
  height = 200,
  width = 720,
  color = "var(--ink)",
  labelEvery,
}: {
  title: string;
  series: Point[];
  height?: number;
  /** Coordinate-space width. Use a smaller one in a narrow column so the
   *  text does not scale down to nothing. */
  width?: number;
  color?: string;
  labelEvery?: number;
}) {
  const pad = { top: 12, right: 12, bottom: 28, left: 40 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const n = Math.max(1, series.length);
  const max = niceMax(Math.max(...series.map((p) => p.value), 1));
  const slot = w / n;
  const bar = Math.max(2, Math.min(28, slot * 0.6));
  const y = (v: number) => pad.top + h - (v / max) * h;
  const every = labelEvery ?? Math.max(1, Math.round(n / 8));
  const ticks = [0, 0.5, 1].map((t) => t * max);

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : "2 4"} />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">
              {fmt(t)}
            </text>
          </g>
        ))}
        {series.map((p, i) => {
          const cx = pad.left + slot * i + slot / 2;
          return (
            <g key={p.label}>
              <rect x={cx - bar / 2} y={y(p.value)} width={bar} height={Math.max(0, pad.top + h - y(p.value))} rx="2" fill={color} opacity={p.value === 0 ? 0.25 : 0.9}>
                <title>{`${p.label}: ${fmt(p.value)}`}</title>
              </rect>
              {i % every === 0 && (
                <text x={cx} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--ink-3)">
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <DataTable caption={title} rows={series} />
    </figure>
  );
}

/** Horizontal bars with the label and value beside each — for rankings. */
export function HorizontalBars({
  title,
  series,
  color = "var(--accent)",
  format = fmt,
}: {
  title: string;
  series: Point[];
  color?: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(...series.map((p) => p.value), 1);
  return (
    <figure>
      <ul className="flex flex-col gap-2.5" aria-label={title}>
        {series.map((p) => (
          <li key={p.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-ink-2" title={p.label}>
              {p.label}
            </span>
            <span className="h-2.5 overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full" style={{ width: `${(p.value / max) * 100}%`, background: color }} />
            </span>
            <span className="tabular-nums text-ink">{format(p.value)}</span>
          </li>
        ))}
        {series.length === 0 && <li className="text-sm text-ink-3">Nothing in this period.</li>}
      </ul>
    </figure>
  );
}

/** A donut with a legend — for how a total splits. */
export function Donut({
  title,
  series,
  colors = ["var(--accent)", "var(--ink)", "var(--ok)", "var(--warn)", "var(--ink-3)"],
  centre,
}: {
  title: string;
  series: Point[];
  colors?: string[];
  centre?: { value: string; label: string };
}) {
  const total = series.reduce((s, p) => s + p.value, 0);
  const r = 44;
  const c = 2 * Math.PI * r;
  // Each slice starts where the previous one ended; worked out up front
  // rather than by mutating a counter while rendering.
  const slices = series.reduce<{ point: Point; len: number; offset: number }[]>((acc, point) => {
    const len = total ? (point.value / total) * c : 0;
    const offset = acc.length ? acc[acc.length - 1]!.offset + acc[acc.length - 1]!.len : 0;
    acc.push({ point, len, offset });
    return acc;
  }, []);
  return (
    <figure className="flex items-center gap-6">
      <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0" role="img" aria-label={`${title}: ${fmt(total)} in total`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="14" />
        {slices.map(({ point: p, len, offset }, i) => (
          <circle
            key={p.label}
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={colors[i % colors.length]}
            strokeWidth="14"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 60 60)"
          >
            <title>{`${p.label}: ${fmt(p.value)} (${total ? Math.round((p.value / total) * 100) : 0}%)`}</title>
          </circle>
        ))}
        {centre && (
          <>
            <text x="60" y="58" textAnchor="middle" fontSize="20" fontWeight="600" fill="var(--ink)">
              {centre.value}
            </text>
            <text x="60" y="74" textAnchor="middle" fontSize="9" fill="var(--ink-3)">
              {centre.label}
            </text>
          </>
        )}
      </svg>
      <ul className="flex flex-col gap-1.5 text-sm">
        {series.map((p, i) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors[i % colors.length] }} />
            <span className="text-ink-2">{p.label}</span>
            <span className="ml-auto pl-4 tabular-nums">{fmt(p.value)}</span>
            <span className="w-10 text-right text-xs text-ink-3 tabular-nums">{total ? Math.round((p.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
