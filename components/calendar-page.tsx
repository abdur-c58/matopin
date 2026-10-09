"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { dayKey } from "@/lib/srs";
import { entriesOf, formatDuration, groupByDay, startOfDay, streaks, studyMs, type Day, type Entry } from "@/lib/stats";
import { COLORS } from "./charts";
import { firstOfMonth, MonthCalendar, MonthNav } from "./month-calendar";
import { Panel } from "./ui";
import { useProfileData } from "./use-stats";

const WEEKS = 53;

function level(count: number, max: number): number {
  if (!count) return 0;
  return Math.min(4, Math.ceil((count / max) * 4));
}
const LEVELS = ["bg-raised", "bg-volt-500/25", "bg-volt-500/50", "bg-volt-500/75", "bg-volt-500"];

function Heatmap({ days, now, selected, onSelect }: { days: Map<string, Day>; now: number; selected: string; onSelect: (key: string, at: number) => void }) {
  const end = startOfDay(now);
  const lastMonday = startOfDay(end, -((new Date(end).getDay() + 6) % 7));
  const start = startOfDay(lastMonday, -(WEEKS - 1) * 7);
  const max = Math.max(1, ...[...days.values()].map((d) => d.reviews));
  const columns = Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => startOfDay(start, w * 7 + d)));
  const total = [...days.values()].filter((d) => d.start >= start).reduce((s, d) => s + d.reviews, 0);

  return (
    <Panel title="Past year" className="lg:col-span-12" action={<span className="text-xs text-muted"><span className="font-semibold text-ink tabular-nums">{total.toLocaleString()}</span> reviews</span>}>
      <div className="overflow-x-auto pb-1">
        <div className="flex w-max gap-[3px]">
          {columns.map((week, w) => (
            <div key={w} className="flex flex-col gap-[3px]">
              <span className="h-4 text-[10px] text-muted">{new Date(week[0]).getDate() <= 7 ? new Date(week[0]).toLocaleDateString(undefined, { month: "short" }) : ""}</span>
              {week.map((at) => {
                const key = dayKey(at);
                const count = days.get(key)?.reviews ?? 0;
                if (at > end) return <span key={key} className="size-3.5" />;
                return (
                  <button
                    key={key} type="button" onClick={() => onSelect(key, at)}
                    className={`size-3.5 rounded-[4px] transition hover:ring-2 hover:ring-ink/40 ${LEVELS[level(count, max)]} ${selected === key ? "ring-2 ring-ink" : ""}`}
                    aria-label={`${new Date(at).toLocaleDateString(undefined, { dateStyle: "long" })}: ${count} review${count === 1 ? "" : "s"}`}
                    title={`${new Date(at).toLocaleDateString(undefined, { dateStyle: "medium" })}: ${count} review${count === 1 ? "" : "s"}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted">
        Less {LEVELS.map((c) => <span key={c} className={`size-3 rounded-[3px] ${c}`} />)} More
      </div>
    </Panel>
  );
}

function DayDetails({ dayEntries, at, now, names, cards }: { dayEntries: Entry[]; at: number; now: number; names: Map<string, string>; cards: Map<string, string> }) {
  const byDeck = new Map<string, number>();
  for (const e of dayEntries) byDeck.set(e.deck, (byDeck.get(e.deck) ?? 0) + 1);
  const again = dayEntries.filter((e) => e.rating === 1).length;
  const studied = [...new Set(dayEntries.map((e) => e.key.split(":")[0]))].map((id) => cards.get(id)).filter(Boolean) as string[];
  return (
    <Panel className="lg:col-span-5" title={new Date(at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}>
      {dayEntries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">{at > now ? "This day hasn’t happened yet." : "No reviews on this day."}</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["Reviews", dayEntries.length], ["Time", formatDuration(studyMs(dayEntries))], ["Again", again]].map(([label, value]) => (
              <div key={label} className="rounded-md bg-raised px-2 py-3">
                <p className="text-xl font-bold tabular-nums">{value}</p>
                <p className="text-xs text-muted">{label}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted">Decks</p>
            <ul className="space-y-1.5">
              {[...byDeck].sort((a, b) => b[1] - a[1]).map(([deck, n]) => (
                <li key={deck} className="flex items-center gap-3 text-sm">
                  <Link href={`/decks/${deck}/review`} className="min-w-0 flex-1 truncate hover:text-volt-500">{names.get(deck) ?? "Deleted deck"}</Link>
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full" style={{ width: `${(n / dayEntries.length) * 100}%`, background: COLORS.volt }} /></div>
                  <span className="w-8 text-right tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          </div>
          {studied.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted">Cards studied</p>
              <ul className="flex flex-wrap gap-1.5">
                {studied.slice(0, 40).map((term, i) => <li key={i} className="rounded-full bg-raised px-2.5 py-1 font-hanzi text-base">{term}</li>)}
                {studied.length > 40 && <li className="px-2 py-1 text-xs text-muted">+{studied.length - 40} more</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

export function CalendarPage() {
  const data = useProfileData();
  const entries = useMemo(() => (data ? entriesOf(data.decks) : []), [data]);
  const days = useMemo(() => groupByDay(entries), [entries]);
  const [selected, setSelected] = useState<{ key: string; at: number } | null>(null);
  const [month, setMonth] = useState<number | null>(null);

  if (!data) return <p className="p-10 text-center text-sm text-muted">Loading your calendar…</p>;
  const { decks, now } = data;
  const pick = selected ?? { key: dayKey(now), at: startOfDay(now) };
  const shownMonth = month ?? firstOfMonth(now);
  const counts = new Map([...days].map(([k, d]) => [k, d.reviews]));
  const { current, longest } = streaks(entries, now);
  const names = new Map(decks.map((d) => [d.id, d.name]));
  const cards = new Map(decks.flatMap((d) => d.cards.map((c) => [c.id, c.term || c.reading] as const)));
  const monthDays = [...days.values()].filter((d) => firstOfMonth(d.start) === shownMonth);

  const select = (key: string, at: number) => { setSelected({ key, at }); setMonth(firstOfMonth(at)); };

  return (
    <main className="grid gap-x-8 gap-y-10 px-page pt-6 pb-10 lg:grid-cols-12 [&>*]:min-w-0">
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-3 lg:col-span-12">
        {([["Current streak", `${current} day${current === 1 ? "" : "s"}`, true], ["Longest streak", `${longest} day${longest === 1 ? "" : "s"}`, false], ["Days studied", `${days.size}`, false]] as const).map(([label, value, accent]) => (
          <div key={label}>
            <p className="text-sm text-muted">{label}</p>
            <p className={`mt-1 text-3xl font-bold tracking-tight tabular-nums ${accent ? "text-volt-500" : ""}`}>{value}</p>
          </div>
        ))}
      </div>

      <Heatmap days={days} now={now} selected={pick.key} onSelect={select} />

      <Panel className="lg:col-span-7" title="Month" action={<MonthNav month={shownMonth} onMonth={setMonth} latest={firstOfMonth(now)} />}>
        <MonthCalendar variant="plain" month={shownMonth} counts={counts} now={now} selected={pick.key} onSelect={(key) => select(key, new Date(`${key}T00:00:00`).getTime())} />
        <div className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center text-sm">
          <div><p className="text-lg font-bold tabular-nums">{monthDays.length}</p><p className="text-xs text-muted">active days</p></div>
          <div><p className="text-lg font-bold tabular-nums">{monthDays.reduce((s, d) => s + d.reviews, 0)}</p><p className="text-xs text-muted">reviews</p></div>
          <div><p className="text-lg font-bold tabular-nums">{formatDuration(monthDays.reduce((s, d) => s + d.ms, 0))}</p><p className="text-xs text-muted">studied</p></div>
        </div>
      </Panel>

      <DayDetails at={pick.at} now={now} dayEntries={entries.filter((e) => dayKey(e.at) === pick.key)} names={names} cards={cards} />
    </main>
  );
}
