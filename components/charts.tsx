"use client";
import { useId, useState } from "react";

export const COLORS = {
  volt: "var(--color-volt-500)", orange: "#ff9f43", purple: "#a78bfa", second: "var(--color-second-500)", red: "#ff5f61", green: "#46d68c", sky: "#7b93ff", track: "#2a2a2a",
} as const;

export type Series = { name: string; color: string; values: number[] };

/** Catmull-Rom through the points, as cubic Béziers, so the line passes through every value. */
function smoothPath(points: [number, number][]): string {
  if (!points.length) return "";
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${Math.max(0, c1[1])} ${c2[0]},${Math.max(0, c2[1])} ${p2[0]},${p2[1]}`;
  }
  return d;
}

const W = 600;
const H = 200;
const PAD = 14;

export function LineChart({ series, labels, height = 180, format = (n: number) => String(n) }: {
  series: Series[]; labels: string[]; height?: number; format?: (n: number) => string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const count = labels.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => (count <= 1 ? W / 2 : (i / (count - 1)) * W);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const at = hover ?? null;
  const tickEvery = Math.max(1, Math.ceil(count / 7));

  return (
    <div className="relative select-none" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.name} id={`${id}-fill-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: s.color }} stopOpacity="0.28" />
              <stop offset="1" style={{ stopColor: s.color }} stopOpacity="0" />
            </linearGradient>
          ))}
          <filter id={`${id}-glow`} x="-10%" y="-30%" width="120%" height="160%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} x1="0" x2={W} y1={PAD + t * (H - PAD * 2)} y2={PAD + t * (H - PAD * 2)} stroke="currentColor" className="text-line" strokeDasharray="3 6" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s, i) => {
          const points = s.values.map((v, j) => [x(j), y(v)] as [number, number]);
          const line = smoothPath(points);
          return (
            <g key={s.name}>
              {i === 0 && points.length > 1 && <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${id}-fill-${i})`} />}
              <path d={line} fill="none" style={{ stroke: s.color }} strokeWidth="6" opacity="0.35" filter={`url(#${id}-glow)`} vectorEffect="non-scaling-stroke" />
              <path d={line} fill="none" style={{ stroke: s.color }} strokeWidth="2.25" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {at != null && <line x1={x(at)} x2={x(at)} y1={0} y2={H} stroke="currentColor" className="text-ink/25" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />}
      </svg>
      {at != null && series.map((s) => (
        <span key={s.name} className="pointer-events-none absolute size-2.5 -translate-1/2 rounded-full border-2 border-surface" style={{ left: `${(x(at) / W) * 100}%`, top: `${(y(s.values[at] ?? 0) / H) * 100}%`, background: s.color }} />
      ))}
      {at != null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-volt-500 px-2.5 py-1.5 text-on-volt shadow-pop"
          style={{ left: `${Math.min(88, Math.max(12, (x(at) / W) * 100))}%`, top: `${(y(Math.max(...series.map((s) => s.values[at] ?? 0))) / H) * 100 - 4}%` }}
        >
          <p className="text-[10px] font-semibold opacity-70">{labels[at]}</p>
          {series.map((s) => <p key={s.name} className="text-xs font-bold whitespace-nowrap tabular-nums">{format(s.values[at] ?? 0)} <span className="font-medium opacity-70">{s.name}</span></p>)}
        </div>
      )}
      <div className="absolute inset-0 flex" onMouseLeave={() => setHover(null)}>
        {labels.map((label, i) => <div key={i} className="h-full flex-1" onMouseEnter={() => setHover(i)} aria-label={`${label}: ${series.map((s) => `${format(s.values[i] ?? 0)} ${s.name}`).join(", ")}`} role="img" />)}
      </div>
      <div className="pointer-events-none absolute inset-x-0 -bottom-5 flex justify-between text-[10px] text-muted">
        {labels.map((label, i) => <span key={i} className={`w-0 text-center whitespace-nowrap ${i % tickEvery === 0 || i === count - 1 ? "" : "invisible"}`}><span className="inline-block -translate-x-1/2">{label}</span></span>)}
      </div>
    </div>
  );
}

export type Segment = { value: number; color: string; label: string };

export function BarChart({ bars, height = 160, highlight }: { bars: { label: string; segments: Segment[] }[]; height?: number; highlight?: number }) {
  const max = Math.max(1, ...bars.map((b) => b.segments.reduce((s, x) => s + x.value, 0)));
  const tickEvery = Math.max(1, Math.ceil(bars.length / 8));
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {bars.map((bar, i) => {
          const total = bar.segments.reduce((s, x) => s + x.value, 0);
          return (
            <div key={i} className="group relative flex h-full flex-1 flex-col justify-end" title={`${bar.label}: ${bar.segments.map((s) => `${s.value} ${s.label}`).join(", ")}`}>
              <div className={`flex flex-col-reverse overflow-hidden rounded-full transition-opacity ${highlight != null && highlight !== i ? "opacity-60 group-hover:opacity-100" : ""}`} style={{ height: `${Math.max(total ? 4 : 2, (total / max) * 100)}%` }}>
                {total === 0 ? <div className="h-full bg-raised" /> : bar.segments.map((s) => s.value > 0 && <div key={s.label} style={{ flexGrow: s.value, background: s.color }} />)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-[3px] text-[10px] text-muted">
        {bars.map((bar, i) => (
          <span key={i} className="flex flex-1 justify-center">
            <span className={`w-0 whitespace-nowrap ${i % tickEvery === 0 ? "" : "invisible"}`}><span className="inline-block -translate-x-1/2">{bar.label}</span></span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Ring({ value, size = 96, stroke = 10, color = COLORS.volt, children }: { value: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, value));
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: color }} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} className="transition-[stroke-dasharray] duration-700" />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}

export function Donut({ parts, size = 150, stroke = 18, children }: { parts: Segment[]; size?: number; stroke?: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((s, p) => s + p.value, 0);
  const gap = total && parts.filter((p) => p.value > 0).length > 1 ? 4 : 0;
  let offset = 0;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.track} strokeWidth={stroke} />
        {total > 0 && parts.map((p) => {
          if (!p.value) return null;
          const length = (p.value / total) * c;
          const el = <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: p.color }} strokeWidth={stroke} strokeDasharray={`${Math.max(0, length - gap)} ${c}`} strokeDashoffset={-offset} />;
          offset += length;
          return el;
        })}
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}

export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const v = Math.min(1, Math.max(0, value));
  return (
    <div className={`h-3 overflow-hidden rounded-full bg-raised ${className}`}>
      <div className="h-full rounded-full bg-volt-500 bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(0_0_0/0.12)_6px_12px)] transition-[width] duration-700" style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: React.ReactNode }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: item.color }} />
          {item.label}
          {item.value != null && <span className="font-semibold text-ink tabular-nums">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}
