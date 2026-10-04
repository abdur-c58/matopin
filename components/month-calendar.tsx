"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayKey } from "@/lib/srs";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export const monthLabel = (month: number) => new Date(month).toLocaleDateString(undefined, { month: "long", year: "numeric" });

export function firstOfMonth(at: number, offset = 0): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime();
}

/** Monday-first weeks of the month, with nulls before the 1st and after the last day. */
function weeks(month: number): (number | null)[] {
  const first = new Date(month);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(new Date(first.getFullYear(), first.getMonth(), d).getTime());
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function MonthNav({ month, onMonth, light, latest }: { month: number; onMonth: (m: number) => void; light?: boolean; latest: number }) {
  const btn = `grid size-8 place-items-center rounded-full transition disabled:opacity-30 ${light ? "bg-on-volt/10 hover:bg-on-volt/20" : "bg-raised hover:text-ink"}`;
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={btn} aria-label="Previous month" onClick={() => onMonth(firstOfMonth(month, -1))}><ChevronLeft className="size-4" /></button>
      <span className="min-w-28 text-center text-sm font-semibold">{monthLabel(month)}</span>
      <button type="button" className={btn} aria-label="Next month" disabled={month >= latest} onClick={() => onMonth(firstOfMonth(month, 1))}><ChevronRight className="size-4" /></button>
    </div>
  );
}

/** `accent` sits on an accent-coloured card, so it draws in the accent's contrast colour. */
export function MonthCalendar({ month, counts, now, selected, onSelect, variant = "accent" }: {
  month: number; counts: Map<string, number>; now: number; selected?: string; onSelect?: (key: string) => void; variant?: "accent" | "plain";
}) {
  const today = dayKey(now);
  const accent = variant === "accent";
  return (
    <div>
      <div className={`grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold ${accent ? "text-on-volt/60" : "text-muted"}`}>
        {WEEKDAYS.map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1.5">
        {weeks(month).map((day, i) => {
          if (day == null) return <span key={i} />;
          const key = dayKey(day);
          const count = counts.get(key) ?? 0;
          const isToday = key === today;
          const future = day > now;
          const label = `${new Date(day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}: ${count} review${count === 1 ? "" : "s"}`;
          const tone = accent
            ? `${count ? "bg-on-volt/85 text-volt-500" : "bg-on-volt/10 text-on-volt/70"} ${isToday ? "ring-2 ring-on-volt ring-offset-2 ring-offset-volt-500" : ""}`
            : isToday ? "bg-volt-500 text-on-volt" : count ? "bg-volt-500/80 text-on-volt" : "bg-raised text-muted";
          const cell = `relative mx-auto grid aspect-square w-full max-w-11 place-items-center rounded-full text-xs font-semibold tabular-nums transition ${tone} ${future ? "opacity-40" : ""} ${selected === key ? "ring-2 ring-offset-2 ring-offset-surface " + (accent ? "ring-on-volt" : "ring-volt-500") : ""}`;
          const dot = count > 0 && !isToday && <span className={`absolute bottom-1 size-1 rounded-full ${accent ? "bg-volt-500" : "bg-on-volt/60"}`} />;
          return onSelect ? (
            <button key={i} type="button" className={`${cell} hover:brightness-110`} aria-label={label} aria-pressed={selected === key} onClick={() => onSelect(key)}>{new Date(day).getDate()}{dot}</button>
          ) : (
            <span key={i} className={cell} title={label} aria-label={label} role="img">{new Date(day).getDate()}{dot}</span>
          );
        })}
      </div>
    </div>
  );
}
