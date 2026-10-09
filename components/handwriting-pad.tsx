"use client";
import { Eraser, LoaderCircle, Undo2, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { recognize, type Point, type Recognized, type Stroke } from "@/lib/handwriting";
import { LANG_INFO, LANGS, type Lang } from "@/lib/lang";

/** Recognition waits for a short pause so a character isn't read after every stroke. */
const SETTLE_MS = 350;

export function RiceGrid() {
  return (
    <svg className="pointer-events-none absolute inset-0 size-full text-line" viewBox="0 0 100 100" aria-hidden>
      <g stroke="currentColor" strokeWidth="0.6" strokeDasharray="2 2" fill="none">
        <line x1="0" y1="0" x2="100" y2="100" /><line x1="100" y1="0" x2="0" y2="100" />
        <line x1="50" y1="0" x2="50" y2="100" /><line x1="0" y1="50" x2="100" y2="50" />
      </g>
    </svg>
  );
}

function paint(el: HTMLCanvasElement | null, strokes: Stroke[]) {
  if (!el) return;
  const { width, height } = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (el.width !== w || el.height !== h) {
    el.width = w;
    el.height = h;
  }
  const ctx = el.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = getComputedStyle(el).color;
  ctx.lineWidth = Math.max(4, width / 36);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    ctx.beginPath();
    stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (stroke.length === 1) ctx.lineTo(stroke[0][0] + 0.1, stroke[0][1]);
    ctx.stroke();
  }
}

/**
 * A square to write characters in by finger, pen or mouse. Picking a candidate hands it over and clears the square.
 * With `onLang`, a 中/日 switch hands the strokes so far to the other language's pad, which reads them again.
 */
export function HandwritingPad({ onPick, onClose, compact = false, lang = "zh", initialStrokes, onLang }: {
  onPick: (text: string) => void; onClose: () => void; compact?: boolean; lang?: Lang;
  initialStrokes?: Stroke[]; onLang?: (lang: Lang, strokes: Stroke[]) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>(initialStrokes ?? []);
  const drawing = useRef<Stroke | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const [count, setCount] = useState(initialStrokes?.length ?? 0);
  const [result, setResult] = useState<Recognized | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const resize = new ResizeObserver(() => paint(el, strokes.current));
    resize.observe(el);
    return () => {
      resize.disconnect();
      clearTimeout(timer.current);
      request.current?.abort();
    };
  }, []);

  const redraw = () => paint(canvas.current, drawing.current ? [...strokes.current, drawing.current] : strokes.current);

  const read = () => {
    request.current?.abort();
    const el = canvas.current;
    if (!el || !strokes.current.length) return;
    const { width, height } = el.getBoundingClientRect();
    const ctrl = new AbortController();
    request.current = ctrl;
    setBusy(true);
    setFailed(false);
    recognize(strokes.current, width, height, ctrl.signal, lang).then(
      (r) => { if (!ctrl.signal.aborted) { setResult(r); setBusy(false); } },
      () => { if (!ctrl.signal.aborted) { setFailed(true); setBusy(false); } },
    );
  };

  // Strokes carried over from the other language's pad are read again in this one.
  const readCarried = useEffectEvent(() => read());
  useEffect(() => {
    if (!strokes.current.length) return;
    const t = window.setTimeout(readCarried, 0);
    return () => clearTimeout(t);
  }, []);

  const reset = () => {
    clearTimeout(timer.current);
    request.current?.abort();
    strokes.current = [];
    drawing.current = null;
    setCount(0);
    setResult(null);
    setBusy(false);
    setFailed(false);
    redraw();
  };

  const undo = () => {
    if (strokes.current.length <= 1) return reset();
    strokes.current = strokes.current.slice(0, -1);
    setCount(strokes.current.length);
    redraw();
    clearTimeout(timer.current);
    read();
  };

  const at = (e: { clientX: number; clientY: number }): Point => {
    const rect = canvas.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const end = () => {
    if (!drawing.current) return;
    strokes.current = [...strokes.current, drawing.current];
    drawing.current = null;
    setCount(strokes.current.length);
    redraw();
    clearTimeout(timer.current);
    timer.current = window.setTimeout(read, SETTLE_MS);
  };

  const candidates = result?.candidates ?? [];

  return (
    <div className="mt-3 animate-panel rounded-md border border-line bg-raised/40 p-3">
      <div className={`relative mx-auto aspect-square w-full overflow-hidden rounded-lg border border-line bg-porcelain ${compact ? "max-w-[12rem]" : "max-w-[18rem]"}`}>
        <RiceGrid />
        <canvas ref={canvas} aria-label={`Writing area: draw a ${lang === "ja" ? "kanji, kana" : "Chinese character"} or word`} className="absolute inset-0 size-full cursor-crosshair touch-none text-ink"
          onPointerDown={(e) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            clearTimeout(timer.current);
            drawing.current = [at(e)];
            redraw();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
            for (const ev of events.length ? events : [e.nativeEvent]) drawing.current.push(at(ev));
            redraw();
          }}
          onPointerUp={end} onPointerCancel={end} />
        {!count && <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-muted">Write a character here</p>}
      </div>

      <div className="mt-3 flex min-h-12 items-center gap-1 overflow-x-auto" role="listbox" aria-label="Recognized characters" aria-busy={busy}>
        {candidates.map((c) => (
          <button key={c} type="button" role="option" aria-selected={false} onClick={() => { onPick(c); reset(); }}
            lang={lang === "ja" ? "ja" : "zh-CN"} className="h-11 shrink-0 rounded-lg border border-line bg-surface px-3 font-hanzi text-2xl leading-none transition-colors hover:border-volt-500 hover:bg-volt-500/10">
            {c}
          </button>
        ))}
        {!candidates.length && (
          <p className="px-1 text-xs text-muted">
            {busy ? "Reading…" : failed ? "Couldn’t read that. Check your connection and try again." : count ? "No match yet. Keep writing or undo a stroke." : "Matches appear here as you write."}
          </p>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1">
        <button type="button" className="icon-btn" aria-label="Undo stroke" title="Undo stroke" disabled={!count} onClick={undo}><Undo2 className="size-4" /></button>
        <button type="button" className="icon-btn" aria-label="Clear drawing" title="Clear" disabled={!count} onClick={reset}><Eraser className="size-4" /></button>
        <span className="ml-1 flex min-w-0 flex-1 items-center gap-1.5 truncate text-[11px] text-muted">
          {busy && <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden />}
          {result?.offline && !busy && (lang === "ja" ? "Offline recognition: one kanji at a time" : "Offline recognition: one character at a time")}
        </span>
        {onLang && (
          <div role="radiogroup" aria-label="Handwriting language" className="flex shrink-0 rounded-full bg-porcelain p-0.5">
            {LANGS.map((l) => (
              <button key={l} type="button" role="radio" aria-checked={l === lang} onClick={() => onLang(l, strokes.current)}
                aria-label={`Read as ${LANG_INFO[l].name}`} title={l === lang ? `Reading as ${LANG_INFO[l].name}` : `Read as ${LANG_INFO[l].name}`}
                className={`grid h-7 min-w-8 place-items-center rounded-full px-2 font-hanzi text-sm transition-colors ${l === lang ? "bg-ink text-porcelain" : "text-muted hover:text-ink"}`}>
                <span lang={LANG_INFO[l].speech}>{LANG_INFO[l].badge}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="icon-btn" aria-label="Close drawing pad" title="Close" onClick={onClose}><X className="size-4" /></button>
      </div>
    </div>
  );
}
