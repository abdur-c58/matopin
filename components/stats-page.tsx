"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Brain, Clock, Flame, Repeat } from "lucide-react";
import {
  byHour, cardStates, entriesOf, forecast, formatDuration, lastDays, ratingCounts, retention, startOfDay, streaks, studyMs,
  type DeckData,
} from "@/lib/stats";
import { BarChart, COLORS, Donut, Legend } from "./charts";
import { Chips, Panel } from "./ui";
import { useProfileData } from "./use-stats";

type Range = "7" | "30" | "90" | "365";
const RANGES: { value: Range; label: string }[] = [
  { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "3 months" }, { value: "365", label: "1 year" },
];

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);

function Tile({ icon: Icon, label, value, note, accent }: { icon: typeof Brain; label: string; value: string; note: string; accent?: boolean }) {
  return (
    <section className={`rounded-3xl p-5 ${accent ? "bg-volt-500 text-on-volt" : "surface"}`}>
      <div className="flex items-center justify-between">
        <p className={`text-sm ${accent ? "font-medium text-on-volt/70" : "text-muted"}`}>{label}</p>
        <span className={`grid size-9 place-items-center rounded-full ${accent ? "bg-on-volt/10" : "bg-raised text-muted"}`}><Icon className="size-4" /></span>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className={`mt-1 text-xs ${accent ? "text-on-volt/70" : "text-muted"}`}>{note}</p>
    </section>
  );
}

function bucketed<T>(items: T[], size: number, merge: (group: T[]) => T): T[] {
  if (size <= 1) return items;
  const out: T[] = [];
  for (let i = 0; i < items.length; i += size) out.push(merge(items.slice(i, i + size)));
  return out;
}

function DeckTable({ decks, since }: { decks: DeckData[]; since: number }) {
  const rows = decks.map((d) => {
    const recent = d.store.revlog.filter((e) => e.at >= since);
    return { deck: d, reviews: recent.length, retention: retention(recent), due: d.session.due.new + d.session.due.learning + d.session.due.review, time: studyMs(recent) };
  }).sort((a, b) => b.reviews - a.reviews);
  return (
    <Panel title="By deck" className="lg:col-span-6">
      {rows.length === 0 ? <p className="text-sm text-muted">No decks yet.</p> : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-2 pb-2 font-medium">Deck</th>
                <th className="px-2 pb-2 text-right font-medium">Cards</th>
                <th className="px-2 pb-2 text-right font-medium">Reviews</th>
                <th className="px-2 pb-2 text-right font-medium">Retention</th>
                <th className="px-2 pb-2 text-right font-medium">Time</th>
                <th className="px-2 pb-2 text-right font-medium">Due</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map(({ deck, reviews, retention: r, due, time }) => (
                <tr key={deck.id} className="border-t border-line">
                  <td className="max-w-40 truncate px-2 py-2.5 font-semibold"><Link href={`/decks/${deck.id}/review`} className="hover:text-volt-500">{deck.name}</Link></td>
                  <td className="px-2 text-right text-muted">{deck.cards.length}</td>
                  <td className="px-2 text-right">{reviews}</td>
                  <td className="px-2 text-right">{pct(r)}</td>
                  <td className="px-2 text-right text-muted">{formatDuration(time)}</td>
                  <td className={`px-2 text-right font-semibold ${due ? "text-volt-500" : "text-muted"}`}>{due}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function StatsPage() {
  const data = useProfileData();
  const [range, setRange] = useState<Range>("30");
  const entries = useMemo(() => (data ? entriesOf(data.decks) : []), [data]);

  if (!data) return <p className="p-10 text-center text-sm text-muted">Loading statistics…</p>;
  const { decks, now } = data;
  const count = Number(range);
  const since = startOfDay(now, -count + 1);
  const recent = entries.filter((e) => e.at >= since);
  const days = lastDays(entries, count, now);
  const active = days.filter((d) => d.reviews > 0).length;
  const { current, longest } = streaks(entries, now);
  const states = cardStates(decks);
  const ratings = ratingCounts(recent);
  const ratingTotal = ratings[1] + ratings[2] + ratings[3] + ratings[4];
  const due = forecast(decks, 30, now);
  const hours = byHour(recent);

  const size = count > 90 ? 7 : count > 30 ? 3 : 1;
  const fmt = (start: number) => new Date(start).toLocaleDateString(undefined, count <= 7 ? { weekday: "short" } : { month: "short", day: "numeric" });
  const bars = bucketed(days, size, (g) => ({ ...g[0], learning: g.reduce((s, d) => s + d.learning, 0), review: g.reduce((s, d) => s + d.review, 0), relearning: g.reduce((s, d) => s + d.relearning, 0) }))
    .map((d) => ({ label: fmt(d.start), segments: [
      { label: "review", value: d.review, color: COLORS.volt },
      { label: "learning", value: d.learning, color: COLORS.orange },
      { label: "relearning", value: d.relearning, color: COLORS.purple },
    ] }));

  return (
    <main className="space-y-4 px-4 pt-5 pb-10 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips<Range> label="Time range" value={range} onChange={setRange} options={RANGES} />
        <p className="text-xs text-muted">Studied on {active} of {count} days</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        <Tile accent icon={Repeat} label="Reviews" value={recent.length.toLocaleString()} note={`${(recent.length / count).toFixed(1)} per day on average`} />
        <Tile icon={Brain} label="Retention" value={pct(retention(recent))} note="Reviews you remembered" />
        <Tile icon={Clock} label="Study time" value={formatDuration(studyMs(recent))} note={recent.length ? `${Math.round(studyMs(recent) / recent.length / 1000)}s per card` : "No reviews yet"} />
        <Tile icon={Flame} label="Streak" value={`${current} day${current === 1 ? "" : "s"}`} note={`Longest ${longest} day${longest === 1 ? "" : "s"}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-12 [&>*]:min-w-0">
        <Panel title="Reviews per day" className="lg:col-span-8" action={<Legend items={[{ label: "Review", color: COLORS.volt }, { label: "Learning", color: COLORS.orange }, { label: "Relearning", color: COLORS.purple }]} />}>
          <BarChart bars={bars} height={200} />
        </Panel>

        <Panel title="Card states" className="lg:col-span-4">
          <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col xl:flex-row">
            <Donut parts={[
              { label: "New", value: states.new, color: COLORS.sky },
              { label: "Learning", value: states.learning, color: COLORS.orange },
              { label: "Young", value: states.young, color: COLORS.green },
              { label: "Mature", value: states.mature, color: COLORS.volt },
              { label: "Suspended", value: states.suspended, color: "#555" },
            ]}>
              <p className="text-2xl font-bold tabular-nums">{states.new + states.learning + states.young + states.mature + states.suspended}</p>
              <p className="text-xs text-muted">cards</p>
            </Donut>
            <ul className="w-full space-y-2 text-sm">
              {([["New", states.new, COLORS.sky], ["Learning", states.learning, COLORS.orange], ["Young", states.young, COLORS.green], ["Mature", states.mature, COLORS.volt], ["Suspended", states.suspended, "#555"]] as const).map(([label, value, color]) => (
                <li key={label} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: color }} />
                  <span className="flex-1 text-muted">{label}</span>
                  <span className="font-semibold tabular-nums">{value}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel title="Answer buttons" className="lg:col-span-4">
          <ul className="space-y-3">
            {([[1, "Again", COLORS.red], [2, "Hard", COLORS.orange], [3, "Good", COLORS.volt], [4, "Easy", COLORS.green]] as const).map(([r, label, color]) => (
              <li key={r}>
                <div className="mb-1 flex justify-between text-sm"><span>{label}</span><span className="text-muted tabular-nums">{ratings[r]} · {ratingTotal ? Math.round((ratings[r] / ratingTotal) * 100) : 0}%</span></div>
                <div className="h-2.5 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${ratingTotal ? (ratings[r] / ratingTotal) * 100 : 0}%`, background: color }} /></div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Due in the next 30 days" className="lg:col-span-8" action={<span className="text-xs text-muted"><span className="font-semibold text-ink tabular-nums">{due[0]}</span> today · <span className="font-semibold text-ink tabular-nums">{due.slice(0, 7).reduce((a, b) => a + b, 0)}</span> this week</span>}>
          <BarChart height={160} highlight={0} bars={due.map((n, i) => ({ label: i === 0 ? "Today" : new Date(startOfDay(now, i)).toLocaleDateString(undefined, { month: "short", day: "numeric" }), segments: [{ label: "due", value: n, color: i === 0 ? COLORS.volt : COLORS.second }] }))} />
        </Panel>

        <Panel title="Time of day" className="lg:col-span-6" action={<span className="text-xs text-muted">Reviews by hour</span>}>
          <BarChart height={150} bars={hours.map((n, h) => ({ label: `${String(h).padStart(2, "0")}h`, segments: [{ label: "reviews", value: n, color: COLORS.orange }] }))} />
        </Panel>

        <DeckTable decks={decks} since={since} />
      </div>
    </main>
  );
}
