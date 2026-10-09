"use client";
import { useRef, useState } from "react";
import { Popover } from "radix-ui";
import { Check, Monitor, Moon, Pipette, Sun } from "lucide-react";
import { toast } from "sonner";
import { ACCENT_PRESETS, applyAccent, applySecond, applyTheme, hexToHsv, SECOND_PRESETS, hsvToHex, normalizeHex, textOn, type Hsv, type ThemeMode } from "@/lib/theme";
import { useProfile } from "./profiles";
import { Panel } from "./ui";

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Pointer and arrow-key dragging inside an element, reported as 0–1 fractions of its width and height. */
function useDrag(onMove: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (box) onMove(clamp((e.clientX - box.left) / box.width), clamp((e.clientY - box.top) / box.height));
  };
  return {
    ref,
    onPointerDown: (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); },
    onPointerMove: (e: React.PointerEvent) => { if (e.buttons & 1) move(e); },
  };
}

function ColorPicker({ initial, onChange }: { initial: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(initial));
  const [text, setText] = useState(initial);
  const hex = hsvToHex(hsv);

  function update(next: Hsv) {
    setHsv(next);
    const value = hsvToHex(next);
    setText(value);
    onChange(value);
  }

  const area = useDrag((x, y) => update({ ...hsv, s: x, v: 1 - y }));
  const hue = useDrag((x) => update({ ...hsv, h: x * 360 }));

  function nudge(e: React.KeyboardEvent, apply: (dx: number, dy: number) => void) {
    const step = e.shiftKey ? 0.1 : 0.02;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    apply(d[0], d[1]);
  }

  return (
    <div className="space-y-3">
      <div
        {...area}
        role="slider" tabIndex={0} aria-label="Saturation and brightness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.s * 100)} aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        onKeyDown={(e) => nudge(e, (dx, dy) => update({ ...hsv, s: clamp(hsv.s + dx), v: clamp(hsv.v + dy) }))}
        className="relative h-40 cursor-crosshair touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ink"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
      >
        <span className="pointer-events-none absolute size-4 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <div
        {...hue}
        role="slider" tabIndex={0} aria-label="Hue" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)}
        onKeyDown={(e) => nudge(e, (dx) => update({ ...hsv, h: (hsv.h + dx * 360 + 360) % 360 }))}
        className="relative h-3.5 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ink"
        style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
      >
        <span className="pointer-events-none absolute top-1/2 size-4.5 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <div className="flex items-center gap-2">
        <span className="size-10 shrink-0 rounded-lg border border-line" style={{ background: hex }} />
        <label className="flex h-10 min-w-0 flex-1 items-center rounded-lg border border-line bg-porcelain px-3 text-sm focus-within:border-volt-edge/70">
          <span className="text-muted">#</span>
          <input
            className="min-w-0 flex-1 bg-transparent pl-1 font-mono uppercase outline-none"
            aria-label="Hex colour" maxLength={7} spellCheck={false} autoComplete="off"
            value={text.replace(/^#/, "")}
            onChange={(e) => {
              setText(e.target.value);
              const valid = normalizeHex(e.target.value);
              if (valid && valid.length === 7 && e.target.value.replace(/^#/, "").length === 6) {
                setHsv(hexToHsv(valid));
                onChange(valid);
              }
            }}
            onBlur={() => setText(hex)}
          />
        </label>
      </div>
    </div>
  );
}

/** Preset swatches plus a custom colour wheel. The colour previews live while picking and saves on Done. */
function ColourChoice({ label, value, presets, apply, onSave }: {
  label: string; value: string; presets: readonly { label: string; hex: string }[]; apply: (hex: string) => void; onSave: (hex: string) => void;
}) {
  const custom = !presets.some((p) => p.hex === value);
  const [open, setOpen] = useState(false);
  const draft = useRef(value);

  function save(hex: string) {
    if (hex !== value) onSave(hex);
  }

  function toggleCustom(next: boolean) {
    setOpen(next);
    if (next) draft.current = value;
    else save(draft.current);
  }

  const swatch = "relative grid size-11 place-items-center rounded-full shadow-[inset_0_0_0_1px] shadow-ink/10 ring-offset-2 ring-offset-surface transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink";

  return (
    <div role="radiogroup" aria-label={label} className="grid w-fit grid-cols-5 gap-3">
      {presets.map((p) => {
        const on = value === p.hex;
        return (
          <button key={p.hex} type="button" role="radio" aria-checked={on} aria-label={p.label} title={p.label}
            className={`${swatch} ${on ? "ring-2 ring-ink" : ""}`} style={{ background: p.hex }} onClick={() => save(p.hex)}>
            {on && <Check className="size-5" style={{ color: textOn(p.hex) }} />}
          </button>
        );
      })}
      <Popover.Root open={open} onOpenChange={toggleCustom}>
        <Popover.Trigger
          role="radio" aria-checked={custom} aria-label={custom ? `Custom colour ${value}` : "Custom colour"} title="Custom colour"
          className={`${swatch} ${custom ? "ring-2 ring-ink" : ""}`}
          style={{ background: custom ? value : "conic-gradient(from 90deg, #ff6b6b, #ffd93d, #6bff95, #4dd8ff, #8b7bff, #ff6bd6, #ff6b6b)" }}
        >
          {custom ? <Check className="size-5" style={{ color: textOn(value) }} /> : <span className="grid size-6 place-items-center rounded-full bg-surface/85"><Pipette className="size-3.5" /></span>}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side="bottom" align="start" sideOffset={10} collisionPadding={12} className="popup w-64 p-4"
            onEscapeKeyDown={() => { draft.current = value; apply(value); }}>
            <p className="mb-3 text-sm font-semibold">Custom colour</p>
            <ColorPicker initial={value} onChange={(hex) => { draft.current = hex; apply(hex); }} />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost h-9 px-3" onClick={() => { draft.current = value; apply(value); setOpen(false); }}>Cancel</button>
              <Popover.Close className="btn btn-primary h-9 px-4">Done</Popover.Close>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

const MODES: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: "system", label: "System", icon: Monitor },
  { mode: "light", label: "Light", icon: Sun },
  { mode: "dark", label: "Dark", icon: Moon },
];

function AppearancePicker({ value, onPick }: { value: ThemeMode; onPick: (mode: ThemeMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Appearance" className="inline-flex gap-1 rounded-full border border-line bg-porcelain p-1">
      {MODES.map(({ mode, label, icon: Icon }) => {
        const on = mode === value;
        return (
          <button key={mode} type="button" role="radio" aria-checked={on} onClick={() => { if (!on) onPick(mode); }}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors ${on ? "bg-volt-500 text-on-volt" : "text-muted hover:bg-raised hover:text-ink"}`}>
            <Icon className="size-4" />{label}
          </button>
        );
      })}
    </div>
  );
}

export function ThemePanel({ className = "" }: { className?: string }) {
  const { prefs, setPrefs } = useProfile();
  const save = (patch: { accent: string } | { second: string } | { theme: ThemeMode }) =>
    void setPrefs(patch).catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't save the theme."));

  return (
    <Panel title="Theme" className={className}>
      <p className="text-sm text-muted">Changes the look across the app, on every device.</p>
      <p className="mt-4 mb-2 text-sm font-semibold">Appearance</p>
      <AppearancePicker value={prefs.theme} onPick={(theme) => { applyTheme(theme); save({ theme }); }} />
      <p className="mt-5 mb-2 text-sm font-semibold">Highlight</p>
      <ColourChoice label="Highlight colour" value={prefs.accent} presets={ACCENT_PRESETS} apply={applyAccent} onSave={(hex) => save({ accent: hex })} />
      <p className="mt-5 text-sm font-semibold">Second colour</p>
      <p className="mb-2 text-xs text-muted">Bao, due decks, and secondary buttons and badges.</p>
      <ColourChoice label="Second colour" value={prefs.second} presets={SECOND_PRESETS} apply={applySecond} onSave={(hex) => save({ second: hex })} />
    </Panel>
  );
}
