'use client';
/**
 * A tiny self-contained SVG bar chart — no external CDN, matching the platform's
 * CSP (Task 12 §4.7). Every chart also ships an accessible data-table fallback.
 */
export interface Bar {
  label: string;
  value: number;
}

export function BarChart({
  data,
  height = 160,
  format = (n: number) => String(n),
}: {
  data: Bar[];
  height?: number;
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const barW = data.length > 0 ? 100 / data.length : 100;
  return (
    <div>
      <svg
        viewBox={`0 0 100 ${String(height)}`}
        preserveAspectRatio="none"
        className="w-full"
        role="img"
        aria-label="bar chart"
      >
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 20);
          return (
            <rect
              key={d.label}
              x={i * barW + barW * 0.15}
              y={height - h}
              width={barW * 0.7}
              height={h}
              className="fill-primary"
            >
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Chart data</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
