"use client";
import { useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { AI_FEATURE_INFO, AI_FEATURES, type AiFeature, type AiMode } from "@/lib/prefs";
import { useProfile } from "./profiles";

const MODES: { value: AiMode; label: string; detail: string }[] = [
  { value: "all", label: "Allow all AI services", detail: "Every AI feature is available." },
  { value: "some", label: "Allow certain features", detail: "Pick the ones you want. The rest are hidden and never used." },
  { value: "none", label: "Allow none", detail: "No AI features. Matopin works fully without them." },
];

/** Settings: which AI services this account uses. Turned-off services are hidden in the app and refused by the server. */
export function AiPanel({ id, className = "" }: { id?: string; className?: string }) {
  const { prefs, setPrefs } = useProfile();
  const [busy, setBusy] = useState<string | null>(null);

  async function save(patch: { aiMode?: AiMode; aiFeatures?: AiFeature[] }, key: string, done: string) {
    setBusy(key);
    try {
      await setPrefs(patch);
      toast.success(done);
    } catch {
      toast.error("Couldn’t save that. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const pickMode = (mode: AiMode) => {
    // Choosing certain features with none ticked would be the same as none, so it starts from everything.
    const features = mode === "some" && !prefs.aiFeatures.length ? { aiFeatures: [...AI_FEATURES] } : {};
    void save({ aiMode: mode, ...features }, mode, mode === "all" ? "All AI services are on." : mode === "none" ? "AI services are off for your account." : "Choose which AI features you want.");
  };
  const toggle = (feature: AiFeature) => {
    const on = !prefs.aiFeatures.includes(feature);
    const next = AI_FEATURES.filter((f) => (f === feature ? on : prefs.aiFeatures.includes(f)));
    void save({ aiFeatures: next }, feature, `${AI_FEATURE_INFO[feature].label} ${on ? "is on" : "is off"}.`);
  };

  return (
    <section id={id} className={`border-t border-line pt-4 ${className}`}>
      <h2 className="text-base font-semibold">AI services</h2>
      <p className="mt-1 text-sm text-muted">Choose which AI features your account uses. Anything you turn off is hidden and never runs for you. Change it back whenever you like.</p>

      <div role="radiogroup" aria-label="AI services" className="mt-4 grid gap-2 sm:grid-cols-3">
        {MODES.map((m) => {
          const on = prefs.aiMode === m.value;
          return (
            <button key={m.value} type="button" role="radio" aria-checked={on} disabled={busy != null} onClick={() => { if (!on) pickMode(m.value); }}
              className={`flex items-start gap-3 rounded-md border p-3 text-left transition-colors disabled:cursor-wait ${on ? "border-volt-500 bg-volt-50" : "border-line hover:border-ink/25 hover:bg-raised"}`}>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className="block text-xs text-muted">{m.detail}</span>
              </span>
              {busy === m.value ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : on && <Check className="size-4 shrink-0 text-volt-500" />}
            </button>
          );
        })}
      </div>

      {prefs.aiMode === "some" && (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {AI_FEATURES.map((f) => (
            <li key={f}>
              <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                <input type="checkbox" className="mt-0.5 size-4 accent-volt-600" checked={prefs.aiFeatures.includes(f)} disabled={busy != null} onChange={() => toggle(f)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{AI_FEATURE_INFO[f].label}</span>
                  <span className="block text-xs text-muted">{AI_FEATURE_INFO[f].detail}</span>
                </span>
                {busy === f && <LoaderCircle className="size-4 shrink-0 animate-spin" />}
              </label>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 max-w-3xl text-xs text-muted">
        <span className="font-semibold text-ink">Your privacy is respected.</span> Nothing you send to an AI feature is used to train AI models. Each feature sends only what it needs, such as the card
        or text you’re working on, and a feature you turn off never receives anything from your account.
      </p>
    </section>
  );
}
