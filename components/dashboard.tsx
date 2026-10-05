"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Flame, Layers, Plus, Sparkles } from "lucide-react";
import { dayKey } from "@/lib/srs";
import {
  cardStates, dueToday, entriesOf, formatDuration, groupByDay, lastDays, MATURE_DAYS, startOfDay, streaks, studyMs,
  type DeckData,
} from "@/lib/stats";
import { COLORS, LineChart, ProgressBar, Ring } from "./charts";
import { useDecks } from "./decks-context";
import { firstOfMonth, MonthCalendar, MonthNav } from "./month-calendar";
import { Chips, Panel } from "./ui";
import { useGoal, useProfileData } from "./use-stats";

type Range = "week" | "month";

function Stat({ label, value, rows }: { label: string; value: React.ReactNode; rows: [string, React.ReactNode][] }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
      <dl className="mt-3 space-y-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function StudyActivity({ decks, now, goal }: { decks: DeckData[]; now: number; goal: number }) {
  const [range, setRange] = useState<Range>("week");
  const entries = useMemo(() => entriesOf(decks), [decks]);
  const days = lastDays(entries, range === "week" ? 7 : 30, now);
  const labels = days.map((d) => new Date(d.start).toLocaleDateString(undefined, range === "week" ? { weekday: "short" } : { month: "short", day: "numeric" }));
  const today = days[days.length - 1];
  const week = lastDays(entries, 7, now);
  const activeWeek = week.filter((d) => d.reviews > 0);
  const states = cardStates(decks);
  const weekStart = startOfDay(now, -6);
  const graduatedThisWeek = entries.filter((e) => e.at >= weekStart && e.kind === "learning" && e.interval > 0).length;

  return (
    <Panel
      className="lg:col-span-8"
      title="Study activity"
      action={<Chips<Range> label="Chart range" value={range} onChange={setRange} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />}
    >
      <div className="pb-6">
        <LineChart
          labels={labels}
          series={[
            { name: "reviews", color: COLORS.volt, values: days.map((d) => d.reviews) },
            { name: "learning", color: COLORS.orange, values: days.map((d) => d.learning + d.relearning) },
            { name: "again", color: COLORS.purple, values: days.map((d) => d.again) },
          ]}
        />
      </div>
      <div className="mt-4 grid gap-6 border-t border-line pt-5 sm:grid-cols-3">
        <Stat label="Reviews today" value={today.reviews.toLocaleString()} rows={[["Goal", goal], ["Daily average", activeWeek.length ? Math.round(activeWeek.reduce((s, d) => s + d.reviews, 0) / activeWeek.length) : 0]]} />
        <Stat label="Cards learned" value={(states.young + states.mature).toLocaleString()} rows={[["Graduated this week", graduatedThisWeek], ["Mature", states.mature]]} />
        <Stat label="Study time today" value={formatDuration(today.ms)} rows={[["This week", formatDuration(studyMs(entries.filter((e) => e.at >= weekStart)))], ["Daily average", formatDuration(activeWeek.length ? activeWeek.reduce((s, d) => s + d.ms, 0) / activeWeek.length : 0)]]} />
      </div>
    </Panel>
  );
}

function ActiveDays({ decks, now }: { decks: DeckData[]; now: number }) {
  const [month, setMonth] = useState(() => firstOfMonth(now));
  const entries = useMemo(() => entriesOf(decks), [decks]);
  const counts = useMemo(() => new Map([...groupByDay(entries)].map(([k, d]) => [k, d.reviews])), [entries]);
  const { current, longest } = streaks(entries, now);
  return (
    <section className="rounded-3xl bg-volt-500 p-5 text-on-volt lg:col-span-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Your active days</h2>
        <MonthNav month={month} onMonth={setMonth} light latest={firstOfMonth(now)} />
      </div>
      <MonthCalendar month={month} counts={counts} now={now} />
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-on-volt/10 px-4 py-2.5 text-sm">
        <span className="flex items-center gap-2 font-semibold"><Flame className="size-4" />{current}-day streak</span>
        <span className="text-on-volt/70">Best {longest}</span>
      </div>
    </section>
  );
}

function DailyGoal({ decks, now, goal }: { decks: DeckData[]; now: number; goal: number }) {
  const today = groupByDay(entriesOf(decks)).get(dayKey(now))?.reviews ?? 0;
  const progress = today / goal;
  return (
    <Panel className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold">Daily goal</h2>
        <p className="mt-1 text-sm text-muted">{progress >= 1 ? "Goal reached. Nice work!" : `${goal - today} more review${goal - today === 1 ? "" : "s"} to go`}</p>
        <p className="mt-4 text-sm"><span className="text-2xl font-bold tabular-nums">{today}</span><span className="text-muted"> / {goal} reviews</span></p>
        <Link href="/settings#daily-goal" className="mt-1 inline-block text-xs text-muted underline-offset-2 hover:text-ink hover:underline">Change goal</Link>
      </div>
      <Ring value={progress} size={104} stroke={11}>
        <span className="text-lg font-bold tabular-nums">{Math.min(999, Math.round(progress * 100))}%</span>
      </Ring>
    </Panel>
  );
}

function Mastery({ decks }: { decks: DeckData[] }) {
  const s = cardStates(decks);
  const total = s.new + s.learning + s.young + s.mature + s.suspended;
  const share = total ? s.mature / total : 0;
  return (
    <Panel title="Mastery plan" action={<span className="text-xs text-muted"><span className="font-semibold text-ink">{Math.round(share * 100)}%</span> mature</span>}>
      <ProgressBar value={share} />
      <div className="mt-2 flex justify-between text-xs text-muted tabular-nums">
        <span>{s.mature} mature</span>
        <span>{total} cards</span>
      </div>
      <p className="mt-3 text-xs text-muted">A card is mature once its next review is {MATURE_DAYS} or more days away.</p>
    </Panel>
  );
}

type DeckFilter = "all" | "due" | "new";

function MyDecks({ decks }: { decks: DeckData[] }) {
  const { create } = useDecks();
  const [filter, setFilter] = useState<DeckFilter>("all");
  const due = (d: DeckData) => d.session.due.new + d.session.due.learning + d.session.due.review;
  const sorted = [...decks].sort((a, b) => due(b) - due(a));
  const shown = sorted.filter((d) => (filter === "due" ? d.session.due.learning + d.session.due.review > 0 : filter === "new" ? d.session.due.new > 0 : true));
  const total = dueToday(decks);

  return (
    <Panel
      className="lg:col-span-8"
      title="My decks"
      action={<span className="text-sm text-muted">{total ? <>You have <span className="font-semibold text-ink">{total}</span> card{total === 1 ? "" : "s"} to study</> : "All caught up"}</span>}
    >
      <Chips<DeckFilter> label="Filter decks" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "due", label: "Reviews due" }, { value: "new", label: "New cards" }]} />
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {shown.slice(0, 7).map((deck, i) => {
          const n = due(deck);
          const featured = i === 0 && n > 0;
          return (
            <li key={deck.id}>
              <Link
                href={`/decks/${deck.id}/review`}
                className={`group flex h-36 flex-col justify-between rounded-3xl p-4 transition hover:-translate-y-0.5 ${featured ? "bg-second-500 text-on-second" : "bg-raised hover:bg-raised/70"}`}
              >
                <div className="flex items-start justify-between">
                  <span className={`grid size-10 place-items-center rounded-2xl ${featured ? "bg-on-second/15" : "bg-surface"}`}>
                    {n ? <BookOpen className="size-[18px]" /> : <Sparkles className="size-[18px] text-volt-500" />}
                  </span>
                  <ArrowUpRight className={`size-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 ${featured ? "" : "text-muted"}`} />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{deck.name}</p>
                  <p className={`text-xl font-bold tabular-nums ${featured ? "" : n ? "text-volt-500" : "text-muted"}`}>{n ? `${n} due` : "Done"}</p>
                </div>
              </Link>
            </li>
          );
        })}
        <li>
          <button type="button" onClick={() => void create()} className="flex h-36 w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-line text-sm text-muted transition hover:border-volt-500/60 hover:text-ink">
            <span className="grid size-10 place-items-center rounded-full bg-raised"><Plus className="size-5" /></span>
            New deck
          </button>
        </li>
      </ul>
      {shown.length === 0 && decks.length > 0 && <p className="mt-3 text-sm text-muted">No decks match this filter.</p>}
      {shown.length > 7 && <Link href="/decks" className="mt-3 inline-block text-sm text-muted hover:text-ink">See all {shown.length} decks</Link>}
    </Panel>
  );
}

export function Dashboard() {
  const data = useProfileData();
  const [goal] = useGoal();
  const { archived } = useDecks();

  if (!data) return <p className="p-10 text-center text-sm text-muted">Loading your dashboard…</p>;
  const { decks, now } = data;
  const away = new Set(archived.map((d) => d.id));
  const learning = decks.filter((d) => !away.has(d.id));

  return (
    <main className="grid gap-4 px-4 pt-5 pb-10 md:px-8 lg:grid-cols-12 [&>*]:min-w-0">
      {learning.length === 0 && (
        <section className="surface flex flex-wrap items-center gap-4 p-5 lg:col-span-12">
          <span className="grid size-12 place-items-center rounded-2xl bg-volt-500 text-on-volt"><Layers className="size-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Start with your first deck</p>
            <p className="text-sm text-muted">Add words, phrases, or sentences, and your progress shows up here as you study.</p>
          </div>
        </section>
      )}
      <StudyActivity decks={decks} now={now} goal={goal} />
      <ActiveDays decks={decks} now={now} />
      <div className="grid gap-4 lg:col-span-4">
        <DailyGoal decks={decks} now={now} goal={goal} />
        <Mastery decks={decks} />
      </div>
      <MyDecks decks={learning} />
    </main>
  );
}
